/**
 * @file fs-cleaner 主进程逻辑（纯 fs，无外部进程、无 worker）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 四通道：config / set-config（sync）与 tree / empty-dirs / touch / temp-clean（task）。
 *              扫描类任务只产候选列表，删除动作一律由 renderer 走壳 bridge 移入回收站。
 */
import { readdir, stat, utimes } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { MainPluginContext, RegisterMain, TaskHandlerContext } from '@lumin/plugin-api'
import { makeError } from '@lumin/shared'
import type { ZodType } from 'zod'
import { errnoCode, isStructuredError, toolError } from './errors'
import {
  DEFAULT_TEMP_EXTENSIONS,
  DEFAULT_TREE_DEPTH,
  MAX_SCAN_FILES,
  MAX_TREE_DEPTH,
  MIN_TREE_DEPTH,
  PROGRESS_STEP,
  configResultSchema,
  emptyDirsPayloadSchema,
  emptyDirsResultSchema,
  setConfigPayloadSchema,
  tempCleanPayloadSchema,
  tempCleanResultSchema,
  touchPayloadSchema,
  touchResultSchema,
  treePayloadSchema,
  treeResultSchema,
  type ConfigResult,
  type EmptyDirsPayload,
  type EmptyDirsResult,
  type SetConfigPayload,
  type TempCleanPayload,
  type TempCleanResult,
  type TouchFailure,
  type TouchPayload,
  type TouchResult,
  type TreePayload,
  type TreeResult
} from './schema'
import {
  findEmptyDirs,
  isExcluded,
  matchesExtensions,
  renderTree,
  type DirEntry,
  type TreeNode
} from './tree'

/** 设置键（projects settings 命名空间下） */
const KEY_ROOT = 'lastRoot'
const KEY_TREE_DEPTH = 'treeDepth'
const KEY_TREE_EXCLUDE = 'treeExclude'
const KEY_TEMP_EXTENSIONS = 'tempExtensions'

/** 设置项长度上限（与 schema 一致，存量非法时裁剪） */
const MAX_EXCLUDE_ITEM = 100
const MAX_EXTENSION_ITEM = 32
const MAX_RULES = 50

/** 目录项最小接口（测试可注入内存实现） */
export interface DirentLike {
  name: string
  isDirectory(): boolean
  isFile(): boolean
}

/** 文件信息最小接口 */
export interface StatLike {
  size: number
  mtimeMs: number
  isFile(): boolean
}

/** 可注入依赖（单测传内存 fs，避免真实磁盘） */
export interface FsCleanerDeps {
  readdir(path: string, options: { withFileTypes: true }): Promise<DirentLike[]>
  stat(path: string): Promise<StatLike>
  utimes(path: string, atime: Date, mtime: Date): Promise<void>
}

/** 默认依赖（真实 fs） */
export function createDefaultDeps(): FsCleanerDeps {
  return {
    readdir: (path, options) => readdir(path, options),
    stat: (path) => stat(path),
    utimes: (path, atime, mtime) => utimes(path, atime, mtime)
  }
}

/** zod 校验：失败统一 FC_INVALID_PAYLOAD（取首条 issue 文案） */
function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw makeError('INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '参数无效')
  }
  return parsed.data
}

/** 字符串数组归一（类型过滤 + 去空 + 长度/数量裁剪） */
function normalizeStrings(value: unknown, maxItem: number, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const result = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item !== '' && item.length <= maxItem)
  return result.slice(0, MAX_RULES)
}

/** 读取设置（非法存量回落默认） */
async function readConfig(ctx: MainPluginContext): Promise<ConfigResult> {
  const root = await ctx.settings.get<unknown>(KEY_ROOT, null)
  const depth = await ctx.settings.get<unknown>(KEY_TREE_DEPTH, DEFAULT_TREE_DEPTH)
  const exclude = await ctx.settings.get<unknown>(KEY_TREE_EXCLUDE, [])
  const extensions = await ctx.settings.get<unknown>(KEY_TEMP_EXTENSIONS, DEFAULT_TEMP_EXTENSIONS)
  const parsed = configResultSchema.safeParse({
    lastRoot: typeof root === 'string' && root !== '' ? root : null,
    treeDepth:
      typeof depth === 'number' &&
      Number.isInteger(depth) &&
      depth >= MIN_TREE_DEPTH &&
      depth <= MAX_TREE_DEPTH
        ? depth
        : DEFAULT_TREE_DEPTH,
    treeExclude: normalizeStrings(exclude, MAX_EXCLUDE_ITEM, []),
    tempExtensions: normalizeStrings(extensions, MAX_EXTENSION_ITEM, DEFAULT_TEMP_EXTENSIONS)
  })
  if (parsed.success) return parsed.data
  return {
    lastRoot: null,
    treeDepth: DEFAULT_TREE_DEPTH,
    treeExclude: [],
    tempExtensions: DEFAULT_TEMP_EXTENSIONS
  }
}

/** 扫描计数器（文件 + 目录条目数上限保护） */
interface Guard {
  count: number
  truncated: boolean
}

/**
 * 目录树递归扫描（深度受 maxDepth 限制，深度被截断时的「还有内容」记入 truncated）
 * @param path 当前目录
 * @param maxDepth 允许展开层数
 * @param exclude 排除规则
 * @param taskCtx 任务上下文（进度/取消）
 * @param guard 计数器
 * @param deps 依赖
 * @param depth 当前层（根为 0）
 * @param isRoot 是否根目录（读失败即报错）
 */
async function scanTreeNode(
  path: string,
  maxDepth: number,
  exclude: readonly string[],
  taskCtx: TaskHandlerContext<unknown>,
  guard: Guard,
  deps: FsCleanerDeps,
  depth: number,
  isRoot: boolean
): Promise<TreeNode> {
  const name = basename(path)
  let dirents: DirentLike[]
  try {
    dirents = await deps.readdir(path, { withFileTypes: true })
  } catch (err) {
    if (isRoot) throw toolError('FC_ROOT_INVALID', errnoCode(err))
    return { name, kind: 'dir', children: [] }
  }
  guard.count += dirents.length
  if (guard.count > MAX_SCAN_FILES) throw toolError('FC_TOO_MANY_FILES')

  const dirs: TreeNode[] = []
  const files: TreeNode[] = []
  for (const dirent of dirents) {
    if (taskCtx.signal.aborted) break
    if (isExcluded(dirent.name, exclude)) continue
    const childPath = join(path, dirent.name)
    if (dirent.isDirectory()) {
      let children: TreeNode[] = []
      if (depth + 1 <= maxDepth) {
        const node = await scanTreeNode(
          childPath,
          maxDepth,
          exclude,
          taskCtx,
          guard,
          deps,
          depth + 1,
          false
        )
        children = node.children
      } else if (await hasVisibleEntries(childPath, exclude, deps)) {
        guard.truncated = true
      }
      dirs.push({ name: dirent.name, kind: 'dir', children })
      continue
    }
    if (dirent.isFile()) files.push({ name: dirent.name, kind: 'file', children: [] })
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))
  taskCtx.emit({ kind: 'progress', current: guard.count, message: path })
  return { name, kind: 'dir', children: [...dirs, ...files] }
}

/** 目录是否有可见条目（深度截断判定用；读失败视为无） */
async function hasVisibleEntries(
  path: string,
  exclude: readonly string[],
  deps: FsCleanerDeps
): Promise<boolean> {
  try {
    const dirents = await deps.readdir(path, { withFileTypes: true })
    return dirents.some((dirent) => !isExcluded(dirent.name, exclude))
  } catch {
    return false
  }
}

/** 命中文件收集结果 */
interface Collected {
  files: { path: string; size: number; mtimeMs: number }[]
  scannedFiles: number
  skipped: number
}

/**
 * 迭代栈收集命中扩展名的普通文件（不跟随符号链接，超限报错）
 * @param root 根目录
 * @param recursive 是否包含子目录
 * @param extensions 扩展名规则（空 = 全部）
 * @param needStat 是否读取 size/mtime（touch 不需要）
 */
async function collectMatching(
  root: string,
  recursive: boolean,
  extensions: readonly string[],
  needStat: boolean,
  taskCtx: TaskHandlerContext<unknown>,
  deps: FsCleanerDeps
): Promise<Collected> {
  const files: Collected['files'] = []
  const stack: string[] = [root]
  let examined = 0
  let skipped = 0

  while (stack.length > 0) {
    if (taskCtx.signal.aborted) break
    const dir = stack.pop()
    if (dir === undefined) break
    let dirents: DirentLike[]
    try {
      dirents = await deps.readdir(dir, { withFileTypes: true })
    } catch (err) {
      if (dir === root) throw toolError('FC_ROOT_INVALID', errnoCode(err))
      skipped += 1
      continue
    }
    for (const dirent of dirents) {
      if (dirent.isDirectory()) {
        if (recursive) stack.push(join(dir, dirent.name))
        continue
      }
      if (!dirent.isFile()) continue
      examined += 1
      if (examined > MAX_SCAN_FILES) throw toolError('FC_TOO_MANY_FILES')
      if (extensions.length > 0 && !matchesExtensions(dirent.name, extensions)) continue
      const path = join(dir, dirent.name)
      if (!needStat) {
        files.push({ path, size: 0, mtimeMs: 0 })
        continue
      }
      try {
        const info = await deps.stat(path)
        if (info.isFile()) files.push({ path, size: info.size, mtimeMs: info.mtimeMs })
      } catch {
        skipped += 1
      }
      if (examined % PROGRESS_STEP === 0) {
        taskCtx.emit({ kind: 'progress', current: examined, message: dir })
      }
    }
  }
  return { files, scannedFiles: examined, skipped }
}

/**
 * 注册 fs-cleaner 全部通道（可注入 deps 供测试）
 * @param ctx 主进程插件上下文
 * @param deps 可注入依赖
 */
export function registerWith(ctx: MainPluginContext, deps: FsCleanerDeps): void {
  ctx.registerIpc('config', async (): Promise<ConfigResult> => readConfig(ctx))

  ctx.registerIpc('set-config', async ({ payload }): Promise<ConfigResult> => {
    const parsed = parseOrThrow<SetConfigPayload>(setConfigPayloadSchema, payload)
    if (parsed.lastRoot !== undefined) await ctx.settings.set(KEY_ROOT, parsed.lastRoot)
    await ctx.settings.set(KEY_TREE_DEPTH, parsed.treeDepth)
    await ctx.settings.set(KEY_TREE_EXCLUDE, parsed.treeExclude)
    await ctx.settings.set(KEY_TEMP_EXTENSIONS, parsed.tempExtensions)
    return readConfig(ctx)
  })

  // —— D3 目录树导出 ——
  ctx.registerTask<TreePayload, TreeResult>('tree', async (taskCtx) => {
    const payload = parseOrThrow<TreePayload>(treePayloadSchema, taskCtx.payload)
    await ctx.settings.set(KEY_ROOT, payload.root)
    await ctx.settings.set(KEY_TREE_DEPTH, payload.maxDepth)
    await ctx.settings.set(KEY_TREE_EXCLUDE, payload.exclude)
    const started = Date.now()
    const guard: Guard = { count: 0, truncated: false }
    try {
      const root = await scanTreeNode(
        payload.root,
        payload.maxDepth,
        payload.exclude,
        taskCtx,
        guard,
        deps,
        0,
        true
      )
      const rendered = renderTree(root, { maxDepth: payload.maxDepth })
      return treeResultSchema.parse({
        text: rendered.text,
        dirs: rendered.dirs,
        files: rendered.files,
        truncated: rendered.truncated || guard.truncated,
        elapsedMs: Date.now() - started
      })
    } catch (err) {
      if (isStructuredError(err)) throw err
      throw toolError('FC_TASK_FAILED', err instanceof Error ? err.message : '')
    }
  })

  // —— D4 空文件夹扫描（只判定，不删除） ——
  ctx.registerTask<EmptyDirsPayload, EmptyDirsResult>('empty-dirs', async (taskCtx) => {
    const payload = parseOrThrow<EmptyDirsPayload>(emptyDirsPayloadSchema, taskCtx.payload)
    await ctx.settings.set(KEY_ROOT, payload.root)
    const started = Date.now()
    const entries: DirEntry[] = []
    const stack: string[] = [payload.root]
    let scannedDirs = 0

    while (stack.length > 0) {
      if (taskCtx.signal.aborted) break
      const dir = stack.pop()
      if (dir === undefined) break
      let dirents: DirentLike[]
      try {
        dirents = await deps.readdir(dir, { withFileTypes: true })
      } catch (err) {
        if (dir === payload.root) throw toolError('FC_ROOT_INVALID', errnoCode(err))
        continue
      }
      scannedDirs += 1
      if (scannedDirs > MAX_SCAN_FILES) throw toolError('FC_TOO_MANY_FILES')
      const childDirs: string[] = []
      let entriesInDir = 0
      for (const dirent of dirents) {
        if (dirent.isDirectory()) {
          const child = join(dir, dirent.name)
          childDirs.push(child)
          stack.push(child)
          continue
        }
        // 符号链接等非目录条目也计入，避免把「非空目录」误判为空
        entriesInDir += 1
      }
      entries.push({ path: dir, childDirs, fileCount: entriesInDir })
      if (scannedDirs % PROGRESS_STEP === 0) {
        taskCtx.emit({ kind: 'progress', current: scannedDirs, message: dir })
      }
    }

    return emptyDirsResultSchema.parse({
      dirs: findEmptyDirs(payload.root, entries),
      scannedDirs,
      elapsedMs: Date.now() - started
    })
  })

  // —— D5 批量改文件时间（只改 mtime/atime） ——
  ctx.registerTask<TouchPayload, TouchResult>('touch', async (taskCtx) => {
    const payload = parseOrThrow<TouchPayload>(touchPayloadSchema, taskCtx.payload)
    await ctx.settings.set(KEY_ROOT, payload.root)
    const started = Date.now()
    const collected = await collectMatching(
      payload.root,
      payload.recursive,
      payload.extensions,
      false,
      taskCtx,
      deps
    )
    const total = collected.files.length
    const sample = collected.files.slice(0, 20).map((file) => file.path)
    if (payload.dryRun) {
      return touchResultSchema.parse({
        total,
        updated: 0,
        sample,
        failures: [],
        elapsedMs: Date.now() - started
      })
    }
    const failures: TouchFailure[] = []
    let updated = 0
    const target = new Date(payload.mtimeMs)
    for (const [index, file] of collected.files.entries()) {
      if (taskCtx.signal.aborted) break
      try {
        await deps.utimes(file.path, target, target)
        updated += 1
      } catch (err) {
        failures.push({
          path: file.path,
          code: 'FC_TOUCH_FAILED',
          message: errnoCode(err) || '修改时间失败'
        })
      }
      if (index % PROGRESS_STEP === 0) {
        taskCtx.emit({ kind: 'progress', current: index, total, message: file.path })
      }
    }
    taskCtx.emit({ kind: 'progress', current: total, total, message: '' })
    return touchResultSchema.parse({
      total,
      updated,
      sample,
      failures,
      elapsedMs: Date.now() - started
    })
  })

  // —— D6 临时文件扫描（只扫不删） ——
  ctx.registerTask<TempCleanPayload, TempCleanResult>('temp-clean', async (taskCtx) => {
    const payload = parseOrThrow<TempCleanPayload>(tempCleanPayloadSchema, taskCtx.payload)
    await ctx.settings.set(KEY_ROOT, payload.root)
    await ctx.settings.set(KEY_TEMP_EXTENSIONS, payload.extensions)
    const started = Date.now()
    const collected = await collectMatching(
      payload.root,
      payload.recursive,
      payload.extensions,
      true,
      taskCtx,
      deps
    )
    return tempCleanResultSchema.parse({
      files: collected.files,
      matchedBytes: collected.files.reduce((sum, file) => sum + file.size, 0),
      scannedFiles: collected.scannedFiles,
      skipped: collected.skipped,
      elapsedMs: Date.now() - started
    })
  })

  ctx.log.info('fs-cleaner registered')
}

/** 生产注册入口（壳 tool-mains.ts 调用；测试用 registerWith 注入假 deps） */
export const registerMain: RegisterMain = (ctx) => registerWith(ctx, createDefaultDeps())
