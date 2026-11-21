/**
 * @file JWT 解码（纯 renderer，无 IPC；只解码不验签）
 * @author cuilanchao
 * @date 2026-11-21
 * @description Base64URL 解码 header/payload 并解析 exp/iat 时效；
 *              结构非法一律报 DT_JWT_INVALID（不可重试），detail 指明原因
 */
import { toolError } from './errors'

/** 解码结果 */
export interface JwtDecoded {
  /** header 原始 JSON 对象 */
  header: Record<string, unknown>
  /** payload 原始 JSON 对象 */
  payload: Record<string, unknown>
  /** 签名段原文（不校验） */
  signature: string
  /** 是否存在签名段（`a.b.` 视为缺失） */
  signaturePresent: boolean
  /** payload.exp（秒级 epoch）；非数字或缺失为 null */
  exp: number | null
  /** payload.iat（秒级 epoch）；非数字或缺失为 null */
  iat: number | null
  /** exp 存在且在参考时间之前（exp 缺失视为未过期） */
  expired: boolean
}

/** BASE64 字母表与反查表（不依赖 atob/Buffer） */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const BASE64_LOOKUP = new Map<string, number>(
  [...BASE64_ALPHABET].map((char, index) => [char, index] as const)
)

/** 解码失败（统一错误码） */
function decodeError(detail: string): ReturnType<typeof toolError> {
  return toolError('DT_JWT_INVALID', detail)
}

/**
 * Base64URL → 字节（忽略 `=` 填充）
 * @param input 无填充的 Base64URL 文本
 */
export function base64UrlToBytes(input: string): Uint8Array {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0

  for (const char of input) {
    if (char === '=') continue
    const normalized = char === '-' ? '+' : char === '_' ? '/' : char
    const value = BASE64_LOOKUP.get(normalized)
    if (value === undefined) throw decodeError(`Base64URL 含非法字符：${char}`)
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }

  return Uint8Array.from(bytes)
}

/**
 * Base64URL → UTF-8 字符串
 * @param input 无填充的 Base64URL 文本
 */
export function base64UrlDecode(input: string): string {
  const bytes = base64UrlToBytes(input)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw decodeError('Base64URL 内容不是合法 UTF-8')
  }
}

/**
 * 解析单段 JSON 对象（数组/标量视为非法）
 * @param segment Base64URL 段
 * @param label 段名（用于 detail）
 */
function parseSegment(segment: string, label: string): Record<string, unknown> {
  const text = base64UrlDecode(segment)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw decodeError(`${label} 不是合法 JSON`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw decodeError(`${label} 必须是 JSON 对象`)
  }
  return parsed as Record<string, unknown>
}

/** 取秒级时间戳字段（非有限数字返回 null） */
function seconds(field: unknown): number | null {
  return typeof field === 'number' && Number.isFinite(field) ? field : null
}

/**
 * 解码 JWT（不校验签名，不联网）
 * @param token 原始 token；允许带 `Bearer ` 前缀与首尾空白
 * @param nowSeconds 参考时间（秒级 epoch），缺省取当前时间
 */
export function decodeJwt(
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): JwtDecoded {
  const trimmed = token.trim().replace(/^bearer\s+/i, '')
  if (trimmed === '') throw decodeError('请输入 JWT')

  const segments = trimmed.split('.')
  if (segments.length !== 3) throw decodeError(`分段数须为 3，实际为 ${segments.length}`)

  const [headerSegment, payloadSegment, signatureSegment] = segments
  if (
    headerSegment === undefined ||
    payloadSegment === undefined ||
    signatureSegment === undefined
  ) {
    throw decodeError('分段数须为 3')
  }

  const header = parseSegment(headerSegment, 'Header')
  const payload = parseSegment(payloadSegment, 'Payload')

  const exp = seconds(payload['exp'])
  const iat = seconds(payload['iat'])

  return {
    header,
    payload,
    signature: signatureSegment,
    signaturePresent: signatureSegment !== '',
    exp,
    iat,
    expired: exp !== null && exp <= nowSeconds
  }
}

/**
 * 时间戳（秒级 epoch）→ 本地 `yyyy-MM-dd HH:mm:ss`
 * @param value 秒级 epoch
 */
export function formatJwtTime(value: number): string {
  const date = new Date(value * 1000)
  const pad = (input: number): string => String(input).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}
