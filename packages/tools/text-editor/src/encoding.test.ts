import { describe, expect, it } from 'vitest'
import { decodeBytes, encodeText } from './encoding'

/** UTF-8 “中文” */
const UTF8_ZH = Buffer.from([0xe4, 0xb8, 0xad, 0xe6, 0x96, 0x87])
/** GBK “中文” */
const GBK_ZH = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
/** UTF-16LE BOM + “中文” */
const UTF16LE_ZH = Buffer.from([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65])
/** UTF-16BE BOM + “中文” */
const UTF16BE_ZH = Buffer.from([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87])
/** UTF-8 BOM + “中文” */
const UTF8_BOM_ZH = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), UTF8_ZH])

describe('encoding', () => {
  it('utf8 双向', () => {
    expect(encodeText('中文', 'utf8').equals(UTF8_ZH)).toBe(true)
    expect(decodeBytes(UTF8_ZH, 'utf8')).toBe('中文')
  })

  it('utf8-bom 编码加 BOM，解码去 BOM', () => {
    expect(encodeText('中文', 'utf8-bom').equals(UTF8_BOM_ZH)).toBe(true)
    expect(decodeBytes(UTF8_BOM_ZH, 'utf8-bom')).toBe('中文')
    expect(decodeBytes(UTF8_BOM_ZH, 'utf8')).toBe('中文')
  })

  it('gbk 双向', () => {
    expect(encodeText('中文', 'gbk').equals(GBK_ZH)).toBe(true)
    expect(decodeBytes(GBK_ZH, 'gbk')).toBe('中文')
  })

  it('utf16le 带 BOM 双向', () => {
    expect(encodeText('中文', 'utf16le').equals(UTF16LE_ZH)).toBe(true)
    expect(decodeBytes(UTF16LE_ZH, 'utf16le')).toBe('中文')
  })

  it('utf16be 带 BOM 双向', () => {
    expect(encodeText('中文', 'utf16be').equals(UTF16BE_ZH)).toBe(true)
    expect(decodeBytes(UTF16BE_ZH, 'utf16be')).toBe('中文')
  })

  it('保留换行符原样编码', () => {
    expect(decodeBytes(encodeText('a\r\nb\n', 'utf8'), 'utf8')).toBe('a\r\nb\n')
  })
})
