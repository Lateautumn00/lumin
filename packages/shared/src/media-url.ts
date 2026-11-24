/**
 * @file 本地媒体 URL（lumin-media://）编解码（纯函数，Node 与 renderer 通用）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 背景：Electron 开发态 renderer 由 http://localhost 提供，Chromium 的 URL safety check
 *              拒绝从 http 页面加载 file:// 媒体（MediaError 4 / SRC_NOT_SUPPORTED），UNC 网络路径同理。
 *              统一改为壳级自定义协议 lumin-media://local/<token>，由主进程流式回源本地文件。
 *              路径按 UTF-16 码元（2 字节/字符）编码后转 base64url，保证任意 Windows 路径
 *              （中文 / 空格 / # / 少见代理对）无损往返，且不依赖 Buffer / TextEncoder。
 */

/** 媒体协议 scheme（主进程 protocol 注册与 CSP 共用，唯一来源） */
export const MEDIA_URL_SCHEME = 'lumin-media'

/** 媒体协议 host（standard scheme 下用于校验来源，固定 local） */
export const MEDIA_URL_HOST = 'local'

/** 生成 URL 的固定前缀（小写） */
const MEDIA_URL_PREFIX = `${MEDIA_URL_SCHEME}://${MEDIA_URL_HOST}/`

/** base64url 字母表（RFC 4648 §5，无填充） */
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** 合法 token（仅 base64url 字符，已在编码端保证无填充） */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * 字节序列 → base64url 文本（无 `=` 填充）
 * @param bytes 原始字节
 */
function encodeBase64Url(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    chunks.push(BASE64URL_ALPHABET.charAt(b0 >> 2))
    chunks.push(BASE64URL_ALPHABET.charAt(((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)))
    if (b1 !== undefined) {
      chunks.push(BASE64URL_ALPHABET.charAt(((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)))
    }
    if (b2 !== undefined) chunks.push(BASE64URL_ALPHABET.charAt(b2 & 0x3f))
  }
  return chunks.join('')
}

/**
 * base64url 文本 → 字节序列；非法字符 / 非法长度返回 null
 * @param token base64url 文本（无填充）
 */
function decodeBase64Url(token: string): Uint8Array | null {
  // 任意字符数 ≡ 1 (mod 4) 都不可能由合法 base64url 产生
  if (token.length % 4 === 1) return null
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of token) {
    const index = BASE64URL_ALPHABET.indexOf(char)
    if (index < 0) return null
    buffer = (buffer << 6) | index
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
      buffer &= bits === 0 ? 0 : (1 << bits) - 1
    }
  }
  return new Uint8Array(bytes)
}

/**
 * 路径 → 媒体协议 URL（主进程 resolve 使用）
 * @param filePath 本地绝对路径（不在此校验，由主进程协议 handler 校验）
 * @returns `lumin-media://local/<base64url(UTF-16LE)>`
 */
export function toMediaUrl(filePath: string): string {
  const bytes = new Uint8Array(filePath.length * 2)
  for (let i = 0; i < filePath.length; i += 1) {
    const unit = filePath.charCodeAt(i)
    bytes[i * 2] = unit & 0xff
    bytes[i * 2 + 1] = unit >> 8
  }
  return `${MEDIA_URL_PREFIX}${encodeBase64Url(bytes)}`
}

/**
 * 媒体协议 URL → 本地路径；非本协议 / host 不符 / token 非法返回 null
 * @param url 待解码 URL
 */
export function fromMediaUrl(url: string): string | null {
  if (url.length <= MEDIA_URL_PREFIX.length) return null
  if (url.slice(0, MEDIA_URL_PREFIX.length).toLowerCase() !== MEDIA_URL_PREFIX) return null
  const token = url.slice(MEDIA_URL_PREFIX.length)
  if (!TOKEN_PATTERN.test(token)) return null
  const bytes = decodeBase64Url(token)
  // 编码端固定 2 字节/码元，奇数长度即损坏
  if (bytes === null || bytes.length === 0 || bytes.length % 2 !== 0) return null
  let path = ''
  for (let i = 0; i < bytes.length; i += 2) {
    path += String.fromCharCode((bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8))
  }
  return path
}
