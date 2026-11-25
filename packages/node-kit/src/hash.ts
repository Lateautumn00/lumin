/**
 * @file hash.ts 文件哈希通用能力（node 侧 worker 复用）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 两段哈希原子操作：前缀 SHA-256 与全量 SHA-256（流式读取，按块回调字节数）。
 *              供 file-scanner 的重复文件 / 目录对比页签共用，避免重复实现。
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** 哈希流读取块大小（亦为默认前缀长度 64KB） */
export const HASH_CHUNK_BYTES = 64 * 1024

/**
 * 计算文件前 bytes 字节的 SHA-256
 * @param path 文件路径
 * @param bytes 读取字节数（≤0 时返回空内容摘要）
 */
export function hashFileRange(path: string, bytes: number): Promise<string> {
  if (bytes <= 0) return Promise.resolve(createHash('sha256').digest('hex'))
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path, {
      start: 0,
      end: bytes - 1,
      highWaterMark: HASH_CHUNK_BYTES
    })
    stream.on('data', (chunk: Buffer | string) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * 全量计算文件 SHA-256（按块回调字节数供进度推进）
 * @param path 文件路径
 * @param onBytes 每块字节数回调
 */
export function hashWholeFile(path: string, onBytes: (bytes: number) => void): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path, { highWaterMark: HASH_CHUNK_BYTES })
    stream.on('data', (chunk: Buffer | string) => {
      hash.update(chunk)
      onBytes(typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
