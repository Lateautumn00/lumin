/**
 * @file 文本编码 / 换行符判定与归一（纯函数，无 IO 依赖）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 供文件预览与文本编辑器共用：BOM 识别、编码启发式判定、EOL 检测与互转。
 */

/** BOM 种类（仅识别 UTF-8 / UTF-16LE / UTF-16BE） */
export type BomKind = 'utf8' | 'utf16le' | 'utf16be'

/** 文本编码判定结果 */
export type TextEncoding = 'utf8' | 'utf8-bom' | 'utf16le' | 'utf16be' | 'gbk'

/** 换行符种类 */
export type Eol = '\n' | '\r\n' | '\r'

/**
 * 识别字节序列开头的 BOM
 * @param bytes 原始字节
 */
export function detectBom(bytes: Uint8Array): BomKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf8'
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf16le'
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf16be'
  return null
}

/**
 * 去除文本开头的 U+FEFF（BOM 解码残留）
 * @param text 已解码文本
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function hasUtf16Pattern(bytes: Uint8Array): 'utf16le' | 'utf16be' | null {
  if (bytes.length < 4 || bytes.length % 2 !== 0) return null
  let zeroOdd = 0
  let zeroEven = 0
  const pairs = bytes.length / 2
  for (let i = 0; i < bytes.length; i += 2) {
    if (bytes[i] === 0) zeroEven += 1
    if (bytes[i + 1] === 0) zeroOdd += 1
  }
  if (zeroOdd / pairs > 0.3) return 'utf16le'
  if (zeroEven / pairs > 0.3) return 'utf16be'
  return null
}

function isValidUtf8(bytes: Uint8Array): boolean {
  let index = 0
  while (index < bytes.length) {
    const byte = bytes[index]
    if (byte === undefined) return true
    if (byte <= 0x7f) {
      index += 1
      continue
    }
    let needed: number
    let min: number
    let code: number
    if (byte >= 0xc2 && byte <= 0xdf) {
      needed = 1
      min = 0x80
      code = byte & 0x1f
    } else if (byte >= 0xe0 && byte <= 0xef) {
      needed = 2
      min = 0x800
      code = byte & 0x0f
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      needed = 3
      min = 0x10000
      code = byte & 0x07
    } else {
      return false
    }
    if (index + needed >= bytes.length) return false
    for (let offset = 1; offset <= needed; offset += 1) {
      const cont = bytes[index + offset]
      if (cont === undefined || (cont & 0xc0) !== 0x80) return false
      code = (code << 6) | (cont & 0x3f)
    }
    if (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return false
    index += needed + 1
  }
  return true
}

/**
 * 启发式判定文本编码：BOM 优先 → UTF-16 零字节分布 → UTF-8 严格校验 → 回退 GBK
 * @param bytes 原始字节
 */
export function detectTextEncoding(bytes: Uint8Array): TextEncoding {
  const bom = detectBom(bytes)
  if (bom === 'utf8') return 'utf8-bom'
  if (bom === 'utf16le') return 'utf16le'
  if (bom === 'utf16be') return 'utf16be'

  const utf16 = hasUtf16Pattern(bytes)
  if (utf16 !== null) return utf16

  return isValidUtf8(bytes) ? 'utf8' : 'gbk'
}

/**
 * 检测文本使用的换行符（优先 CRLF，其次单独 CR，默认 LF）
 * @param text 文本
 */
export function detectEol(text: string): Eol {
  if (text.includes('\r\n')) return '\r\n'
  if (text.includes('\r')) return '\r'
  return '\n'
}

/**
 * 统一换行为指定风格
 * @param text 文本
 * @param eol 目标换行符（默认 LF）
 */
export function normalizeEol(text: string, eol: Eol = '\n'): string {
  const lf = text.replace(/\r\n|\r/g, '\n')
  return eol === '\n' ? lf : lf.replace(/\n/g, eol)
}

/**
 * 以 LF 归一后恢复为指定换行风格
 * @param text 文本
 * @param eol 目标换行符
 */
export function restoreEol(text: string, eol: Eol): string {
  return normalizeEol(text, eol)
}
