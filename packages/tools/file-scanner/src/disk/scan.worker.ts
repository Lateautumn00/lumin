/**
 * @file scan.worker.ts 目录递归聚合扫描（worker 线程）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 以 root 为层，对每个直接子目录迭代栈递归汇总大小与文件数；
 *              不跟随符号链接；单文件 stat/子目录读取失败计入 skipped 不中断；
 *              普通文件超上限抛 DA_TOO_MANY_FILES；取消由主进程 terminate。
 */
import { type Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { exposeTask, type TaskRunContext } from '@lumin/node-kit'
import { extensionOf, sortEntries, summarizeTypes, type TypeTotals } from './contract'
import { toolError } from './errors'
import {
  MAX_SCAN_FILES,
  scanDoneSchema,
  type DiskEntry,
  type ScanRequest,
  type ScanResult
} from './schema'

/** 进度推送的最小间隔（按已检查文件数节流，避免事件洪泛） */
export const SCAN_PROGRESS_STEP = 200

/** 扫描计数（seen 含 stat 失败项，用于上限与进度；files 为成功测量数） */
export interface ScanCounters {
  seen: number
  files: number
  dirs: number
  skipped: number
}

/** 目录聚合结果（含全部后代） */
export interface DirectoryAggregate {
  size: number
  fileCount: number
}

/**
 * 统计单个普通文件大小（失败返回 null，由调用方计入 skipped）
 * @param path 文件路径
 */
async function readFileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}

/**
 * 累加单个文件的类型统计（扩展名小写聚合）
 * @param totals 扩展名 → 累计值
 * @param name 文件名
 * @param bytes 文件大小
 */
export function accumulateType(totals: Map<string, TypeTotals>, name: string, bytes: number): void {
  const ext = extensionOf(name)
  const total = totals.get(ext)
  if (total === undefined) {
    totals.set(ext, { files: 1, bytes })
    return
  }
  total.files += 1
  total.bytes += bytes
}

/**
 * 递归汇总单个子目录（迭代栈，避免深目录爆栈）
 * @param dir 子目录
 * @param counters 全局计数（原地累加）
 * @param emit 进度回调（已检查文件数）
 * @param maxFiles 普通文件上限（测试可注入）
 * @param typeTotals 类型统计（原地累加，可缺省）
 */
export async function aggregateDirectory(
  dir: string,
  counters: ScanCounters,
  emit: (seen: number) => void,
  maxFiles: number = MAX_SCAN_FILES,
  typeTotals?: Map<string, TypeTotals>
): Promise<DirectoryAggregate> {
  const stack: string[] = [dir]
  let size = 0
  let fileCount = 0

  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    counters.dirs += 1
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
        stack.push(path)
        continue
      }
      // 符号链接等非普通条目直接跳过（不跟随，避免环与越界）
      if (!dirent.isFile()) continue
      counters.seen += 1
      if (counters.seen > maxFiles) throw toolError('DA_TOO_MANY_FILES')
      const bytes = await readFileSize(path)
      if (bytes === null) {
        counters.skipped += 1
      } else {
        size += bytes
        fileCount += 1
        counters.files += 1
        if (typeTotals !== undefined) accumulateType(typeTotals, dirent.name, bytes)
      }
      if (counters.seen % SCAN_PROGRESS_STEP === 0) emit(counters.seen)
    }
  }
  return { size, fileCount }
}

/**
 * 执行一次目录扫描（root 的直接子项，目录含蓄后代汇总）
 * @param request 根目录与显示阈值（node 侧已 zod 校验；阈值不影响扫描口径）
 * @param ctx 任务上下文（进度推送）
 * @param now 时钟（测试注入）
 * @param maxFiles 普通文件上限（测试注入）
 */
export async function runScan(
  request: ScanRequest,
  ctx: TaskRunContext,
  now: () => number = Date.now,
  maxFiles: number = MAX_SCAN_FILES
): Promise<ScanResult> {
  const started = now()
  const counters: ScanCounters = { seen: 0, files: 0, dirs: 0, skipped: 0 }
  const typeTotals = new Map<string, TypeTotals>()
  const emit = (seen: number): void => {
    ctx.emit({ kind: 'progress', current: seen, stage: 'scan' })
  }
  ctx.emit({ kind: 'progress', current: 0, stage: 'scan' })

  let dirents: Dirent[]
  try {
    dirents = await readdir(request.root, { withFileTypes: true })
  } catch {
    throw toolError('DA_ROOT_INVALID')
  }

  const entries: DiskEntry[] = []
  for (const dirent of dirents) {
    const path = join(request.root, dirent.name)
    if (dirent.isDirectory()) {
      const aggregate = await aggregateDirectory(path, counters, emit, maxFiles, typeTotals)
      entries.push({
        name: dirent.name,
        path,
        kind: 'dir',
        size: aggregate.size,
        fileCount: aggregate.fileCount
      })
      continue
    }
    if (!dirent.isFile()) continue
    counters.seen += 1
    if (counters.seen > maxFiles) throw toolError('DA_TOO_MANY_FILES')
    const bytes = await readFileSize(path)
    if (bytes === null) {
      counters.skipped += 1
    } else {
      counters.files += 1
      accumulateType(typeTotals, dirent.name, bytes)
      entries.push({ name: dirent.name, path, kind: 'file', size: bytes, fileCount: 0 })
    }
    if (counters.seen % SCAN_PROGRESS_STEP === 0) emit(counters.seen)
  }

  const sorted = sortEntries(entries)
  return scanDoneSchema.parse({
    root: request.root,
    entries: sorted,
    totalBytes: sorted.reduce((sum, entry) => sum + entry.size, 0),
    fileCount: counters.files,
    dirCount: counters.dirs,
    skipped: counters.skipped,
    typeStats: summarizeTypes(typeTotals),
    elapsedMs: now() - started
  })
}

exposeTask<ScanRequest, ScanResult>((payload, ctx) => runScan(payload, ctx))
