/**
 * @file Base64 / URL / Hex / Unicode 编解码纯函数（UTF-8 安全，无 IO）
 * @author cuilanchao
 * @date 2026-11-23
 * @description Base64/Hex 用 TextEncoder/TextDecoder 保证中文与 emoji 无损；URL 支持组件级 / 完整（RFC 3986）模式，解码先定位首个非法 %xx（spec §7.1）
 */
import { checkTextSize, toolError, type TextResult } from './errors'

/** btoa 单次处理的分片字节数（防大文本参数展开爆栈） */
const CHUNK_BYTES = 0x8000

/**
 * 文本 → Base64（UTF-8）
 * @param text 原始文本
 */
export function encodeBase64(text: string): TextResult<string> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + CHUNK_BYTES)
    binary += String.fromCharCode(...chunk)
  }
  return { ok: true, value: btoa(binary) }
}

/**
 * Base64 → 文本（严格 UTF-8 解码）
 * @param text Base64 文本（允许换行与空格，自动补齐 padding）
 */
export function decodeBase64(text: string): TextResult<string> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  const stripped = text.replace(/\s+/g, '')
  if (stripped === '') return { ok: true, value: '' }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(stripped)) {
    return { ok: false, error: toolError('TT_BASE64_INVALID', '包含 Base64 字符集之外的字符') }
  }
  const body = stripped.replace(/=+$/, '')
  if (body.length % 4 === 1) {
    return { ok: false, error: toolError('TT_BASE64_INVALID', '长度不符合 Base64 规则') }
  }
  const padded = body + '='.repeat((4 - (body.length % 4)) % 4)
  // 字符集与长度已校验，atob 不会再抛错
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  try {
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false, error: toolError('TT_BASE64_INVALID', '解码结果不是有效的 UTF-8 文本') }
  }
}

/** URL 编码模式：component = encodeURIComponent；full = 组件编码后追加 RFC 3986 的 !'()* */
export type UrlEncodeMode = 'component' | 'full'

/** 完整模式需追加百分号编码的 RFC 3986 额外保留字符 */
const RFC3986_EXTRA_CHARS = /[!'()*]/g

/**
 * 文本 → URL 编码（默认组件级语义，空格编码为 %20）
 * @param text 原始文本
 * @param mode 组件级（encodeURIComponent）/ 完整（追加编码 !'()* 五个字符）
 */
export function encodeUrl(text: string, mode: UrlEncodeMode = 'component'): TextResult<string> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  try {
    const encoded = encodeURIComponent(text)
    if (mode === 'component') return { ok: true, value: encoded }
    return {
      ok: true,
      value: encoded.replace(
        RFC3986_EXTRA_CHARS,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
      )
    }
  } catch (err) {
    return { ok: false, error: toolError('TT_URL_INVALID', String(err)) }
  }
}

/**
 * URL 编码 → 文本（先探测首个非法 %xx 位置再整体解码）
 * @param text 已编码文本
 */
export function decodeUrl(text: string): TextResult<string> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  const invalidIndex = findInvalidPercent(text)
  if (invalidIndex >= 0) {
    return {
      ok: false,
      error: toolError('TT_INVALID_INPUT', `首个非法 % 序列位于索引 ${invalidIndex}`)
    }
  }
  try {
    return { ok: true, value: decodeURIComponent(text) }
  } catch (err) {
    return { ok: false, error: toolError('TT_URL_INVALID', String(err)) }
  }
}

/**
 * 探测首个非法 % 序列（% 后不足两位十六进制）
 * @param text 待探测文本
 * @returns 首个非法 % 的下标；无非法序列返回 -1
 */
function findInvalidPercent(text: string): number {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charAt(index) !== '%') continue
    const first = text.charAt(index + 1)
    const second = text.charAt(index + 2)
    if (!/^[0-9a-fA-F]$/.test(first) || !/^[0-9a-fA-F]$/.test(second)) return index
  }
  return -1
}

/**
 * 文本 → UTF-8 字节的十六进制字符串（小写、空格分隔）
 * @param text 原始文本
 */
export function encodeHex(text: string): TextResult<string> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  const bytes = new TextEncoder().encode(text)
  const parts: string[] = []
  for (const byte of bytes) parts.push(byte.toString(16).padStart(2, '0'))
  return { ok: true, value: parts.join(' ') }
}

/**
 * 十六进制字符串 → 文本（按 UTF-8 严格解码）
 * @param text 十六进制文本（允许空白分隔与大小写混用）
 */
export function decodeHex(text: string): TextResult<string> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  const stripped = text.replace(/\s+/g, '')
  if (stripped === '') return { ok: true, value: '' }
  if (!/^[0-9a-fA-F]+$/.test(stripped)) {
    return { ok: false, error: toolError('TT_HEX_INVALID', '包含十六进制字符集之外的字符') }
  }
  if (stripped.length % 2 !== 0) {
    return { ok: false, error: toolError('TT_HEX_INVALID', '十六进制长度必须为偶数') }
  }
  const bytes = new Uint8Array(stripped.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(stripped.slice(index * 2, index * 2 + 2), 16)
  }
  try {
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false, error: toolError('TT_HEX_INVALID', '解码结果不是有效的 UTF-8 文本') }
  }
}

/**
 * 文本 → Unicode 转义（每个 UTF-16 码元一个 `\uXXXX`，代理对自动拆成两段）
 * @param text 原始文本
 */
export function encodeUnicode(text: string): TextResult<string> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  let output = ''
  for (let index = 0; index < text.length; index += 1) {
    output += `\\u${text.charCodeAt(index).toString(16).toUpperCase().padStart(4, '0')}`
  }
  return { ok: true, value: output }
}

/**
 * Unicode 转义 → 文本（仅识别 `\uXXXX`，其余字符原样保留）
 * @param text 转义文本
 */
export function decodeUnicode(text: string): TextResult<string> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  let output = ''
  let index = 0
  while (index < text.length) {
    const char = text.charAt(index)
    if (char !== '\\' || text.charAt(index + 1) !== 'u') {
      output += char
      index += 1
      continue
    }
    const hex = text.slice(index + 2, index + 6)
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
      return { ok: false, error: toolError('TT_UNICODE_INVALID', `位置 ${index} 的转义不完整`) }
    }
    output += String.fromCharCode(Number.parseInt(hex, 16))
    index += 6
  }
  return { ok: true, value: output }
}
