/**
 * @file UUID / 时间戳 ID 生成（纯 renderer，无 IPC；本机随机数）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 优先 crypto.getRandomValues，缺失时回退 Math.random；UUID 固定 RFC 4122 v4 形态。
 *              批量数量越界报 DT_INVALID_PAYLOAD。
 */
import { toolError } from './errors'

/** 单次批量生成上限 */
export const UUID_MAX_COUNT = 100

/** 时间戳 ID 后缀字母表 */
const SUFFIX_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** 时间戳 ID 后缀长度 */
const SUFFIX_LENGTH = 4

/**
 * 取随机字节（crypto 优先，回退 Math.random）
 * @param length 字节数
 */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  const cryptoApi = globalThis.crypto
  if (cryptoApi !== undefined && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes)
    return bytes
  }
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256)
  }
  return bytes
}

/**
 * 16 字节 → RFC 4122 v4 UUID（写入版本位与变体位）
 * @param bytes 至少 16 字节的随机源（前 16 字节生效）
 */
export function formatUuidV4(bytes: Uint8Array): string {
  const buffer = new Uint8Array(16)
  buffer.set(bytes.subarray(0, 16))
  buffer[6] = ((buffer[6] ?? 0) & 0x0f) | 0x40
  buffer[8] = ((buffer[8] ?? 0) & 0x3f) | 0x80

  const hex = [...buffer].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-')
}

/** 生成单个 UUID v4 */
export function generateUuidV4(): string {
  return formatUuidV4(randomBytes(16))
}

/**
 * 批量生成 UUID v4
 * @param count 数量（1–100 的整数）
 */
export function generateUuids(count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > UUID_MAX_COUNT) {
    throw toolError('DT_INVALID_PAYLOAD', `生成数量须为 1–${UUID_MAX_COUNT} 的整数`)
  }
  return Array.from({ length: count }, () => generateUuidV4())
}

/** 本地时间各段补零拼接 */
function timeParts(date: Date): string {
  const pad = (input: number): string => String(input).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/**
 * 时间戳 ID（`yyyyMMdd-HHmmss-xxxx`）
 * @param date 时间来源，缺省当前时间
 */
export function generateTimestampId(date: Date = new Date()): string {
  const bytes = randomBytes(SUFFIX_LENGTH)
  const suffix = [...bytes]
    .map((byte) => SUFFIX_ALPHABET.charAt(byte % SUFFIX_ALPHABET.length))
    .join('')
  return `${timeParts(date)}-${suffix}`
}
