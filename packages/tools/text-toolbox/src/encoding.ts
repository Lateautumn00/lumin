/**
 * @file Base64 / URL 编解码纯函数（UTF-8 安全，无 IO）
 * @author cuilanchao
 * @date 2026-11-18
 * @description Base64 用 TextEncoder/TextDecoder 保证中文与 emoji 无损；URL 采用 component 语义
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

/**
 * 文本 → URL component 编码（空格编码为 %20，&/=/?# 一并编码）
 * @param text 原始文本
 */
export function encodeUrl(text: string): TextResult<string> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  try {
    return { ok: true, value: encodeURIComponent(text) }
  } catch (err) {
    return { ok: false, error: toolError('TT_URL_INVALID', String(err)) }
  }
}

/**
 * URL component 解码
 * @param text 已编码文本
 */
export function decodeUrl(text: string): TextResult<string> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  try {
    return { ok: true, value: decodeURIComponent(text) }
  } catch (err) {
    return { ok: false, error: toolError('TT_URL_INVALID', String(err)) }
  }
}
