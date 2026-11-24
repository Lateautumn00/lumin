/**
 * @file compare.worker.ts 双目录递归扫描与逐文件配对（worker 线程）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 两侧迭代栈遍历（不跟随符号链接）→ 相对路径 Map → 配对分类；
 *              根目录不可读抛 FC_ROOT_INVALID（detail 标侧别），单侧超限抛 FC_TOO_MANY_FILES；
 *              单文件 stat 失败计入 skipped 不中断；取消由主进程 terminate。
 */
import { type Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  HASH_CHUNK_BYTES,
  exposeTask,
  hashFileRange,
  hashWholeFile,
  type TaskRunContext
} from '@lumin/node-kit'
import {
  classifyPair,
  normalizeRelPath,
  pathKey,
  sortEntries,
  summarize,
  withContentResult
} from './contract'
import { toolError } from './errors'
import {
  MAX_FILES_PER_SIDE,
  MAX_RESULT_ENTRIES,
  compareDoneSchema,
  type CompareEntry,
  type CompareRequest,
  type CompareResult
} from './schema'

/** 进度推送的最小间隔（按已检查文件数节流，避免事件洪泛） */
export const COMPARE_PROGRESS_STEP = 200

/** 内容比较进度节流（每 N 个配对上报一次） */
export const CONTENT_PROGRESS_STEP = 20

/** 单侧侧别 */
export type Side = 'left' | 'right'

/** 侧别中文名（错误 detail 用） */
const SIDE_LABEL: Record<Side, string> = { left: '左侧', right: '右侧' }

/** 单侧扫描计数（seen 含 stat 失败项；files 为成功测量数） */
export interface SideCounters {
  seen: number
  files: number
  dirs: number
  skipped: number
}

/** 单侧文件条目（相对路径 + 元数据） */
export interface SideFile {
  /** 相对路径（`/` 分隔，保留原大小写） */
  rel: string
  size: number
  mtimeMs: number
}

/**
 * 扫描单侧目录：返回 配对键 → 文件条目
 * @param root 根目录
 * @param side 侧别（错误 detail 用）
 * @param counters 计数（原地累加）
 * @param emit 进度回调（已检查文件数）
 * @param maxFiles 普通文件上限（测试可注入）
 */
export async function scanSide(
  root: string,
  side: Side,
  counters: SideCounters,
  emit: (seen: number) => void,
  maxFiles: number = MAX_FILES_PER_SIDE
): Promise<Map<string, SideFile>> {
  try {
    await readdir(root, { withFileTypes: true })
  } catch {
    throw toolError(
      'FC_ROOT_INVALID',
      `${SIDE_LABEL[side]}目录无法读取（不存在、不是目录或无权限）`
    )
  }

  const files = new Map<string, SideFile>()
  const stack: string[] = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    let dirents: Dirent[]
    try {
      dirents = await readdir(current, { withFileTypes: true })
    } catch {
      counters.skipped += 1
      continue
    }
    for (const dirent of dirents) {
      const path = join(current, dirent.name)
      if (dirent.isDirectory()) {
        counters.dirs += 1
        stack.push(path)
        continue
      }
      // 符号链接等非普通条目直接跳过（不跟随，避免环与越界）
      if (!dirent.isFile()) continue
      counters.seen += 1
      if (counters.seen > maxFiles) {
        throw toolError('FC_TOO_MANY_FILES', `${SIDE_LABEL[side]}文件数超过上限`)
      }
      try {
        const info = await stat(path)
        if (!info.isFile()) continue
        const rel = normalizeRelPath(relative(root, path))
        if (rel === '') continue
        files.set(pathKey(rel), { rel, size: info.size, mtimeMs: info.mtimeMs })
        counters.files += 1
      } catch {
        counters.skipped += 1
      }
      if (counters.seen % COMPARE_PROGRESS_STEP === 0) emit(counters.seen)
    }
  }
  return files
}

/**
 * 判断两侧同名同大小文件内容是否一致（64KB 前缀 SHA-256 预筛 → 全量 SHA-256）
 * @param leftPath 左侧文件绝对路径
 * @param rightPath 右侧文件绝对路径
 * @param size 两侧相同的大小（字节）
 */
export async function contentEqual(
  leftPath: string,
  rightPath: string,
  size: number
): Promise<boolean> {
  const prefixBytes = Math.min(HASH_CHUNK_BYTES, size)
  const leftPrefix = await hashFileRange(leftPath, prefixBytes)
  const rightPrefix = await hashFileRange(rightPath, prefixBytes)
  if (leftPrefix !== rightPrefix) return false
  if (size <= HASH_CHUNK_BYTES) return true
  const noop = (): void => undefined
  const leftHash = await hashWholeFile(leftPath, noop)
  const rightHash = await hashWholeFile(rightPath, noop)
  return leftHash === rightHash
}

/**
 * 执行一次文件夹对比（两侧扫描 → 配对 → 可选内容比较 → 排序 → 截断）
 * @param request 左右目录与比较选项（node 侧已 zod 校验）
 * @param ctx 任务上下文（进度推送）
 * @param now 时钟（测试注入）
 * @param maxFiles 单侧普通文件上限（测试注入）
 * @param maxResult 结果条目上限（测试注入）
 */
export async function runCompare(
  request: CompareRequest,
  ctx: TaskRunContext,
  now: () => number = Date.now,
  maxFiles: number = MAX_FILES_PER_SIDE,
  maxResult: number = MAX_RESULT_ENTRIES
): Promise<CompareResult> {
  const started = now()
  const leftCounters: SideCounters = { seen: 0, files: 0, dirs: 0, skipped: 0 }
  const rightCounters: SideCounters = { seen: 0, files: 0, dirs: 0, skipped: 0 }
  const emitSide =
    (side: Side) =>
    (seen: number): void => {
      ctx.emit({ kind: 'progress', current: seen, stage: side })
    }

  ctx.emit({ kind: 'progress', current: 0, stage: 'left' })
  const leftMap = await scanSide(
    request.leftRoot,
    'left',
    leftCounters,
    emitSide('left'),
    maxFiles
  )
  ctx.emit({ kind: 'progress', current: 0, stage: 'right' })
  const rightMap = await scanSide(
    request.rightRoot,
    'right',
    rightCounters,
    emitSide('right'),
    maxFiles
  )

  const keys = new Set<string>([...leftMap.keys(), ...rightMap.keys()])
  const entries: CompareEntry[] = []
  for (const key of keys) {
    const left = leftMap.get(key)
    const right = rightMap.get(key)
    const entry = classifyPair(
      left?.rel ?? right?.rel ?? '',
      left ?? null,
      right ?? null,
      request.compareMtime
    )
    if (entry !== null) entries.push(entry)
  }

  let hashSkipped = 0
  let contentDifferent = 0
  if (request.compareContent) {
    const indexByPath = new Map(entries.map((entry, index) => [entry.path, index]))
    const candidates = entries.filter(
      (entry): entry is CompareEntry & { sizeLeft: number; sizeRight: number } =>
        entry.sizeLeft !== null && entry.sizeRight !== null && entry.sizeLeft === entry.sizeRight
    )
    const total = candidates.length
    ctx.emit({ kind: 'progress', current: 0, total, stage: 'content' })
    let checked = 0
    for (const candidate of candidates) {
      try {
        const same = await contentEqual(
          join(request.leftRoot, candidate.path),
          join(request.rightRoot, candidate.path),
          candidate.sizeLeft
        )
        const merged = withContentResult(candidate, same)
        const index = indexByPath.get(candidate.path)
        if (index !== undefined) entries[index] = merged
        if (merged.contentChanged) contentDifferent += 1
      } catch {
        hashSkipped += 1
      }
      checked += 1
      if (checked % CONTENT_PROGRESS_STEP === 0 || checked === total) {
        ctx.emit({ kind: 'progress', current: checked, total, stage: 'content' })
      }
    }
  }

  const sorted = sortEntries(entries)
  const summary = summarize(entries)
  const limit = Math.max(0, maxResult)
  return compareDoneSchema.parse({
    leftRoot: request.leftRoot,
    rightRoot: request.rightRoot,
    entries: sorted.slice(0, limit),
    ...summary,
    leftFiles: leftCounters.files,
    rightFiles: rightCounters.files,
    skipped: leftCounters.skipped + rightCounters.skipped + hashSkipped,
    truncated: Math.max(0, sorted.length - limit),
    compareMtime: request.compareMtime,
    compareContent: request.compareContent,
    contentDifferent,
    elapsedMs: now() - started
  })
}

exposeTask<CompareRequest, CompareResult>((payload, ctx) => runCompare(payload, ctx))
