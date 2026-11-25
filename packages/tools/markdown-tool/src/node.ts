/**
 * @file markdown-tool 主进程逻辑（config / set-output-dir / save / open-file / save-file）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 无三段式任务：Markdown / JSON→TS / YAML 解析全在 renderer 同步完成；
 *              主进程负责输出目录记忆、导出原子写盘，以及已有 .md 的读取与覆盖保存（mtime 冲突检测）。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { dialog } from 'electron'
import { resolveConflictPath, writeAtomic, type AtomicFs } from '@lumin/node-kit'
import { isStructuredError, makeError, stripBom, type StructuredError } from '@lumin/shared'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import {
  MAX_MD_FILE_BYTES,
  configResultSchema,
  openFilePayloadSchema,
  openFileResultSchema,
  saveFilePayloadSchema,
  saveFileResultSchema,
  savePayloadSchema,
  saveResultSchema,
  setOutputDirPayloadSchema,
  type OpenFileResult,
  type SaveFileResult
} from './schema'
import { errnoCode, toolError } from './errors'
import { sanitizeBaseName } from './save'

/** 文件元数据（stat 子集） */
export interface FileStat {
  size: number
  mtimeMs: number
  isFile(): boolean
}

/** 可注入依赖（单测传假 fs / stat / 对话框） */
export interface MarkdownToolDeps {
  /** 原子写盘 fs 子集 */
  fs?: AtomicFs
  /** 冲突判定（默认 fs.existsSync） */
  exists?: (path: string) => boolean
  /** 文件元数据（默认 node:fs/promises stat） */
  stat?: (path: string) => Promise<FileStat>
  /** 读取字节（默认 node:fs/promises readFile） */
  readFile?: (path: string) => Promise<Buffer>
  /** 系统「打开文件」对话框（默认 dialog.showOpenDialogSync） */
  pickMarkdownFile?: () => string | null
}

/** 错误细节：优先 errno 码，回退消息 */
function detailOf(err: unknown): string {
  return errnoCode(err)
}

/** 读取期错误归一：不存在 / 被占用 / 其余读取失败 */
function classifyReadError(err: unknown): StructuredError {
  if (isStructuredError(err)) return err
  const code = errnoCode(err)
  if (code === 'ENOENT') return toolError('MD_NOT_FOUND', code)
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return toolError('MD_LOCKED', code)
  return toolError('MD_READ_FAILED', detailOf(err))
}

/** 保存期错误归一：不存在 / 被占用 / 其余保存失败 */
function classifySaveError(err: unknown): StructuredError {
  if (isStructuredError(err)) return err
  const code = errnoCode(err)
  if (code === 'ENOENT') return toolError('MD_NOT_FOUND', code)
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return toolError('MD_LOCKED', code)
  return toolError('MD_SAVE_FAILED', detailOf(err))
}

/** 系统「打开文件」对话框（仅 Markdown/纯文本） */
function pickMarkdownFileSync(): string | null {
  const result = dialog.showOpenDialogSync({
    title: '打开 Markdown 文档',
    filters: [{ name: 'Markdown / 文本', extensions: ['md', 'markdown', 'txt'] }],
    properties: ['openFile']
  })
  if (result === undefined || result.length === 0) return null
  return result[0] ?? null
}

/** 生产实现：node:fs/promises */
function createNodeDeps(): {
  stat: (path: string) => Promise<FileStat>
  readFile: (path: string) => Promise<Buffer>
  pickMarkdownFile: () => string | null
} {
  return {
    stat: async (path) => {
      const info = await stat(path)
      return { size: info.size, mtimeMs: info.mtimeMs, isFile: () => info.isFile() }
    },
    readFile: (path) => readFile(path),
    pickMarkdownFile: pickMarkdownFileSync
  }
}

/**
 * 注册 markdown-tool 全部通道（可注入依赖供测试）
 * @param ctx 主进程插件上下文（paths/settings/log/registerIpc）
 * @param deps 可注入依赖
 */
export function registerWith(ctx: MainPluginContext, deps: MarkdownToolDeps = {}): void {
  const defaultOutputDir = join(ctx.paths.userData, 'markdown')
  const exists = deps.exists ?? existsSync
  const nodeDeps = createNodeDeps()
  const statFile = deps.stat ?? nodeDeps.stat
  const readFileFn = deps.readFile ?? nodeDeps.readFile
  const pickMarkdownFile = deps.pickMarkdownFile ?? nodeDeps.pickMarkdownFile

  // —— config（sync）：输出目录记忆回填（settings `outputDir`） ——
  ctx.registerIpc('config', async () => {
    const saved = await ctx.settings.get<string | null>('outputDir', null)
    return configResultSchema.parse({ outputDir: saved ?? defaultOutputDir })
  })

  // —— set-output-dir（sync）：目录选择后即时记忆 ——
  ctx.registerIpc('set-output-dir', async ({ payload }) => {
    const parsed = setOutputDirPayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    await ctx.settings.set('outputDir', parsed.data.outputDir)
  })

  // —— save（sync）：校验 → 清洗 → 冲突命名 → 原子写盘 → 记忆目录 ——
  ctx.registerIpc('save', async ({ payload }) => {
    const parsed = savePayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    const { outputDir, baseName, extension, content } = parsed.data

    try {
      mkdirSync(outputDir, { recursive: true })
    } catch (err) {
      throw toolError('MD_SAVE_FAILED', errnoCode(err))
    }

    const desired = join(outputDir, `${sanitizeBaseName(baseName)}.${extension}`)
    const target = resolveConflictPath(desired, exists)
    if (target === null) throw toolError('MD_SAVE_FAILED', '同名文件过多（超过 99 个）')

    try {
      writeAtomic(target, content, deps.fs)
    } catch (err) {
      throw toolError('MD_SAVE_FAILED', errnoCode(err))
    }

    await ctx.settings.set('outputDir', outputDir)
    return saveResultSchema.parse({ output: target })
  })

  // —— open-file（sync）：对话框或显式路径 → stat 预检 → UTF-8 去 BOM 读取 ——
  ctx.registerIpc('open-file', async ({ payload }): Promise<OpenFileResult | null> => {
    const parsed = openFilePayloadSchema.safeParse(payload ?? {})
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    const path = parsed.data.path ?? pickMarkdownFile()
    if (path === null) return null

    let info: FileStat
    try {
      info = await statFile(path)
    } catch (err) {
      throw classifyReadError(err)
    }
    if (!info.isFile()) throw toolError('MD_READ_FAILED', 'NOT_FILE')
    if (info.size > MAX_MD_FILE_BYTES) throw toolError('MD_FILE_TOO_LARGE', String(info.size))

    let bytes: Buffer
    try {
      bytes = await readFileFn(path)
    } catch (err) {
      throw classifyReadError(err)
    }

    return openFileResultSchema.parse({
      path,
      name: basename(path),
      content: stripBom(bytes.toString('utf8')),
      size: info.size,
      mtimeMs: info.mtimeMs
    })
  })

  // —— save-file（sync）：mtime 冲突检测 → 原子写盘（覆盖原文件 / 另存为） ——
  ctx.registerIpc('save-file', async ({ payload }): Promise<SaveFileResult> => {
    const parsed = saveFilePayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    const { path, content, expectedMtimeMs, force } = parsed.data

    if (expectedMtimeMs !== undefined) {
      let info: FileStat
      try {
        info = await statFile(path)
      } catch (err) {
        throw classifySaveError(err)
      }
      if (!info.isFile()) throw toolError('MD_SAVE_FAILED', 'NOT_FILE')
      if (expectedMtimeMs !== info.mtimeMs && force !== true) throw toolError('MD_FILE_CHANGED')
    }

    try {
      writeAtomic(path, content, deps.fs)
    } catch (err) {
      throw classifySaveError(err)
    }

    let mtimeMs = Date.now()
    try {
      mtimeMs = (await statFile(path)).mtimeMs
    } catch {
      // 写盘已成功，mtime 读取失败时回退当前时间
    }
    return saveFileResultSchema.parse({ path, mtimeMs })
  })

  ctx.log.info('markdown-tool registered', { defaultOutputDir })
}

/** 壳注册入口（plugin-host 调用） */
export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx)
}
