/**
 * @file 文本编解码（仅主进程；GBK / UTF-16 走 iconv-lite）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 与 @lumin/shared 的 detectTextEncoding 配套：解码去 BOM，编码按需加 BOM。
 */
import { stripBom, type TextEncoding } from '@lumin/shared'
import iconv from 'iconv-lite'

/** UTF-8 BOM 字节 */
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
/** UTF-16LE BOM 字节 */
const UTF16LE_BOM = Buffer.from([0xff, 0xfe])
/** UTF-16BE BOM 字节 */
const UTF16BE_BOM = Buffer.from([0xfe, 0xff])

/**
 * 字节 → 文本（按判定编码解码，去除 BOM 残留）
 * @param bytes 原始字节
 * @param encoding 编码判定结果
 */
export function decodeBytes(bytes: Uint8Array, encoding: TextEncoding): string {
  if (encoding === 'utf8' || encoding === 'utf8-bom') {
    return stripBom(new TextDecoder('utf-8').decode(bytes))
  }
  const label = encoding === 'gbk' ? 'gbk' : encoding === 'utf16le' ? 'utf16le' : 'utf16be'
  return stripBom(iconv.decode(Buffer.from(bytes), label))
}

/**
 * 文本 → 字节（UTF-8 BOM / UTF-16 自动补 BOM）
 * @param text 已按目标 EOL 归一化的文本
 * @param encoding 目标编码
 */
export function encodeText(text: string, encoding: TextEncoding): Buffer {
  switch (encoding) {
    case 'utf8':
      return Buffer.from(text, 'utf8')
    case 'utf8-bom':
      return Buffer.concat([UTF8_BOM, Buffer.from(text, 'utf8')])
    case 'gbk':
      return iconv.encode(text, 'gbk')
    case 'utf16le':
      return Buffer.concat([UTF16LE_BOM, iconv.encode(text, 'utf16le')])
    case 'utf16be':
      return Buffer.concat([UTF16BE_BOM, iconv.encode(text, 'utf16be')])
  }
}
