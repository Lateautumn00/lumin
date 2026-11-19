/**
 * @file hash.worker.ts 文件哈希计算任务（worker 线程）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 逐文件顺序处理：先 stat 全部路径（单条失败只记失败项），再对每个文件
 *              单次读流同时喂多个 hash 实例；按 64KB 粒度推送字节进度。
 *              取消由主进程 terminate 本 worker（runTask 统一归一 CANCELLED）。
 */
import { createHash, type Hash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { exposeTask, type TaskRunContext } from '@lumin/node-kit'
import { errnoCode } from './errors'
import {
  MAX_FILE_BYTES,
  hashDoneSchema,
  type Algorithm,
  type HashFileResult,
  type HashRequest,
  type HashResult
} from './schema'

/** 进度推送粒度（读取块大小） */
export const PROGRESS_INTERVAL_BYTES = 64 * 1024

/** 失败项细节上限（errno 之外的异常消息截断） */
const MAX_DETAIL_LENGTH = 200

/**
 * 取错误详情文本（截断）
 * @param err 任意抛出物
 */
export function describeError(err: unknown): string {
  const text =
    err instanceof Error ? err.message : typeof err === 'string' ? err : String(err ?? '未知错误')
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text
}

/**
 * 流式读取一次文件，同时计算多个摘要
 * @param path 文件路径
 * @param algorithms 需要计算的算法
 * @param onBytes 每读到一个块回调块大小（累计由调用方负责）
 */
export function hashFile(
  path: string,
  algorithms: readonly Algorithm[],
  onBytes: (bytes: number) => void
): Promise<HashFileResult['hashes']> {
  return new Promise<HashFileResult['hashes']>((resolve, reject) => {
    const hashes = new Map<Algorithm, Hash>()
    for (const algorithm of algorithms) hashes.set(algorithm, createHash(algorithm))
    const stream = createReadStream(path, { highWaterMark: PROGRESS_INTERVAL_BYTES })
    stream.on('data', (chunk: Buffer | string) => {
      for (const hash of hashes.values()) hash.update(chunk)
      onBytes(typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length)
    })
    stream.on('error', reject)
    stream.on('end', () => {
      const digests: HashFileResult['hashes'] = {}
      for (const [algorithm, hash] of hashes) digests[algorithm] = hash.digest('hex')
      resolve(digests)
    })
  })
}

/** 待计算文件（stat 通过后进入哈希阶段） */
interface PreparedFile {
  index: number
  path: string
  size: number
  mtimeMs: number
}

/**
 * 执行一次批量哈希任务
 * @param request 路径与算法（已由 node 侧 zod 校验）
 * @param ctx 任务上下文（进度推送）
 * @param now 时钟（测试注入）
 */
export async function runHash(
  request: HashRequest,
  ctx: TaskRunContext,
  now: () => number = Date.now
): Promise<HashResult> {
  const started = now()
  const results: HashFileResult[] = []
  const prepared: PreparedFile[] = []

  ctx.emit({ kind: 'progress', current: 0, total: request.paths.length, stage: 'prepare' })
  for (const [index, path] of request.paths.entries()) {
    try {
      const info = await stat(path)
      if (!info.isFile()) {
        throw Object.assign(new Error('不是普通文件'), { code: 'EINVAL' })
      }
      if (info.size > MAX_FILE_BYTES) {
        results[index] = {
          path,
          size: info.size,
          mtimeMs: info.mtimeMs,
          hashes: {},
          status: 'failed',
          code: 'FH_FILE_INVALID',
          message: '文件超过 20 GB 上限'
        }
      } else {
        prepared.push({ index, path, size: info.size, mtimeMs: info.mtimeMs })
      }
    } catch (err) {
      results[index] = {
        path,
        size: 0,
        mtimeMs: 0,
        hashes: {},
        status: 'failed',
        code: 'FH_FILE_INVALID',
        message: errnoCode(err) || describeError(err)
      }
    }
    ctx.emit({
      kind: 'progress',
      current: index + 1,
      total: request.paths.length,
      stage: 'prepare',
      message: path
    })
  }

  const totalBytes = prepared.reduce((sum, file) => sum + file.size, 0)
  let processed = 0
  ctx.emit({ kind: 'progress', current: 0, total: totalBytes, stage: 'hash' })

  for (const file of prepared) {
    try {
      const hashes = await hashFile(file.path, request.algorithms, (bytes) => {
        processed += bytes
        ctx.emit({
          kind: 'progress',
          current: processed,
          total: totalBytes,
          stage: 'hash',
          message: file.path
        })
      })
      results[file.index] = {
        path: file.path,
        size: file.size,
        mtimeMs: file.mtimeMs,
        hashes,
        status: 'ok'
      }
    } catch (err) {
      results[file.index] = {
        path: file.path,
        size: file.size,
        mtimeMs: file.mtimeMs,
        hashes: {},
        status: 'failed',
        code: 'FH_HASH_FAILED',
        message: errnoCode(err) || describeError(err)
      }
    }
  }

  const ordered = results.filter((result): result is HashFileResult => result !== undefined)
  const failedCount = ordered.filter((result) => result.status === 'failed').length
  return hashDoneSchema.parse({
    results: ordered,
    failedCount,
    totalBytes,
    elapsedMs: now() - started
  })
}

exposeTask<HashRequest, HashResult>((payload, ctx) => runHash(payload, ctx))
