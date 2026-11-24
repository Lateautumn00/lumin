/**
 * @file scan.worker.ts 目录扫描与两段哈希（worker 线程）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 阶段一扫描目录收集候选（普通文件 stat + 阈值过滤），阶段二按大小分组做
 *              64KB 前缀 SHA-256 预筛（≤64KB 时前缀即全量），阶段三对剩余候选做全量
 *              SHA-256；单文件读写失败计入 skipped 不中断，取消由主进程 terminate。
 */
import { type Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  exposeTask,
  hashFileRange,
  hashWholeFile,
  type TaskRunContext
} from '@lumin/node-kit'
import { toolError } from './errors'
import {
  MAX_SCAN_FILES,
  PARTIAL_BYTES,
  scanDoneSchema,
  type DuplicateFile,
  type DuplicateGroup,
  type ScanRequest,
  type ScanResult
} from './schema'

/** 进度推送的最小间隔（扫描阶段按文件计数节流，避免事件洪泛） */
export const SCAN_PROGRESS_STEP = 200

/** 候选文件（已通过大小阈值） */
interface Entry {
  path: string
  size: number
  mtimeMs: number
}

/** 扫描阶段收集结果 */
export interface CollectResult {
  entries: Entry[]
  scannedFiles: number
  skipped: number
}

/**
 * 目录遍历收集候选文件（迭代栈，避免深递归爆栈）
 * @param root 根目录
 * @param recursive 是否包含子目录
 * @param minBytes 最小文件大小
 * @param emit 进度回调
 * @param maxFiles 文件数上限（测试可注入）
 */
export async function collectFiles(
  root: string,
  recursive: boolean,
  minBytes: number,
  emit: (scanned: number) => void,
  maxFiles: number = MAX_SCAN_FILES
): Promise<CollectResult> {
  const entries: Entry[] = []
  const dirs: string[] = [root]
  let scannedFiles = 0
  let skipped = 0

  while (dirs.length > 0) {
    const dir = dirs.pop() as string
    let dirents: Dirent[]
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      if (dir === root) throw toolError('DF_ROOT_INVALID')
      skipped += 1
      continue
    }
    for (const dirent of dirents) {
      const path = join(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (recursive) dirs.push(path)
        continue
      }
      // 符号链接等非普通文件直接跳过（不跟随，避免环与越界）
      if (!dirent.isFile()) continue
      scannedFiles += 1
      if (scannedFiles > maxFiles) throw toolError('DF_TOO_MANY_FILES')
      try {
        const info = await stat(path)
        if (info.isFile() && info.size >= minBytes) {
          entries.push({ path, size: info.size, mtimeMs: info.mtimeMs })
        }
      } catch {
        skipped += 1
      }
      if (scannedFiles % SCAN_PROGRESS_STEP === 0) emit(scannedFiles)
    }
  }
  return { entries, scannedFiles, skipped }
}

/** 组装重复组（文件按修改时间升序，可释放空间 = size × (n-1)） */
function makeGroup(size: number, hash: string, files: Entry[]): DuplicateGroup {
  const sorted: DuplicateFile[] = files
    .map((file) => ({ path: file.path, size: file.size, mtimeMs: file.mtimeMs }))
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path))
  return { size, hash, files: sorted, wastedBytes: size * (sorted.length - 1) }
}

/** 组排序：可释放空间降序，其次文件大小降序 */
function byWasted(a: DuplicateGroup, b: DuplicateGroup): number {
  return b.wastedBytes - a.wastedBytes || b.size - a.size
}

/**
 * 执行一次重复文件扫描
 * @param request 根目录 / 是否递归 / 最小文件大小（node 侧已 zod 校验）
 * @param ctx 任务上下文（进度推送）
 * @param now 时钟（测试注入）
 */
export async function runScan(
  request: ScanRequest,
  ctx: TaskRunContext,
  now: () => number = Date.now
): Promise<ScanResult> {
  const started = now()
  ctx.emit({ kind: 'progress', current: 0, stage: 'scan' })
  const collected = await collectFiles(request.root, request.recursive, request.minBytes, (scanned) => {
    ctx.emit({ kind: 'progress', current: scanned, stage: 'scan' })
  })
  let skipped = collected.skipped

  const bySize = new Map<number, Entry[]>()
  for (const entry of collected.entries) {
    const list = bySize.get(entry.size)
    if (list === undefined) bySize.set(entry.size, [entry])
    else list.push(entry)
  }
  const sizeGroups = [...bySize.values()].filter((group) => group.length > 1)
  const candidateFiles = sizeGroups.reduce((sum, group) => sum + group.length, 0)

  /** 前缀哈希后仍可能重复的分桶（final = 前缀已是全量哈希） */
  interface Bucket {
    size: number
    digest: string
    files: Entry[]
    final: boolean
  }
  const buckets: Bucket[] = []
  let index = 0
  ctx.emit({ kind: 'progress', current: 0, total: candidateFiles, stage: 'partial' })
  for (const group of sizeGroups) {
    const size = group[0]?.size ?? 0
    const byPrefix = new Map<string, Entry[]>()
    for (const entry of group) {
      try {
        const digest = await hashFileRange(entry.path, Math.min(PARTIAL_BYTES, entry.size))
        const list = byPrefix.get(digest)
        if (list === undefined) byPrefix.set(digest, [entry])
        else list.push(entry)
      } catch {
        skipped += 1
      }
      index += 1
      ctx.emit({ kind: 'progress', current: index, total: candidateFiles, stage: 'partial' })
    }
    for (const [digest, files] of byPrefix) {
      if (files.length > 1) {
        buckets.push({ size, digest, files, final: size <= PARTIAL_BYTES })
      }
    }
  }

  const fullBytes = buckets
    .filter((bucket) => !bucket.final)
    .reduce((sum, bucket) => sum + bucket.files.reduce((s, file) => s + file.size, 0), 0)
  const groups: DuplicateGroup[] = []
  let processed = 0
  ctx.emit({ kind: 'progress', current: 0, total: fullBytes, stage: 'full' })
  for (const bucket of buckets) {
    if (bucket.final) {
      groups.push(makeGroup(bucket.size, bucket.digest, bucket.files))
      continue
    }
    const byHash = new Map<string, Entry[]>()
    for (const file of bucket.files) {
      try {
        const digest = await hashWholeFile(file.path, (bytes) => {
          processed += bytes
          ctx.emit({
            kind: 'progress',
            current: processed,
            total: fullBytes,
            stage: 'full',
            message: file.path
          })
        })
        const list = byHash.get(digest)
        if (list === undefined) byHash.set(digest, [file])
        else list.push(file)
      } catch {
        skipped += 1
      }
    }
    for (const [digest, files] of byHash) {
      if (files.length > 1) groups.push(makeGroup(bucket.size, digest, files))
    }
  }

  groups.sort(byWasted)
  return scanDoneSchema.parse({
    groups,
    scannedFiles: collected.scannedFiles,
    skipped,
    totalWastedBytes: groups.reduce((sum, group) => sum + group.wastedBytes, 0),
    elapsedMs: now() - started
  })
}

exposeTask<ScanRequest, ScanResult>((payload, ctx) => runScan(payload, ctx))
