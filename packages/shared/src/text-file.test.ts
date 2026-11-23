/**
 * @file text-file.ts 单测：BOM / 编码启发式 / EOL 检测与归一
 * @author cuilanchao
 * @date 2026-11-22
 */
import { describe, expect, it } from 'vitest'
import {
  detectBom,
  detectEol,
  detectTextEncoding,
  normalizeEol,
  restoreEol,
  stripBom
} from './text-file'

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)
const hello = bytes(0x68, 0x65, 0x6c, 0x6c, 0x6f)
const chineseHello = bytes(0xe4, 0xb8, 0xad, 0xe6, 0x96, 0x87, 0x20, 0x68, 0x69)

describe('detectBom', () => {
  it('识别 UTF-8 BOM', () => {
    expect(detectBom(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('utf8')
  })

  it('识别 UTF-16LE / UTF-16BE BOM', () => {
    expect(detectBom(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe('utf16le')
    expect(detectBom(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toBe('utf16be')
  })

  it('无 BOM → null', () => {
    expect(detectBom(hello)).toBeNull()
    expect(detectBom(new Uint8Array([0xef, 0xbb]))).toBeNull()
    expect(detectBom(new Uint8Array([]))).toBeNull()
  })
})

describe('stripBom', () => {
  it('去除开头 U+FEFF', () => {
    expect(stripBom('\uFEFFhello')).toBe('hello')
  })

  it('无 BOM 原样返回', () => {
    expect(stripBom('hello')).toBe('hello')
    expect(stripBom('')).toBe('')
  })
})

describe('detectTextEncoding', () => {
  it('UTF-8 BOM → utf8-bom', () => {
    expect(detectTextEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('utf8-bom')
  })

  it('UTF-16 BOM → utf16le / utf16be', () => {
    expect(detectTextEncoding(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe('utf16le')
    expect(detectTextEncoding(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toBe('utf16be')
  })

  it('无 BOM 但零字节分布呈 UTF-16 → 判定 utf16', () => {
    const le = new Uint8Array([0x61, 0x00, 0x62, 0x00, 0x63, 0x00, 0x64, 0x00])
    expect(detectTextEncoding(le)).toBe('utf16le')
    const be = new Uint8Array([0x00, 0x61, 0x00, 0x62, 0x00, 0x63, 0x00, 0x64])
    expect(detectTextEncoding(be)).toBe('utf16be')
  })

  it('合法 UTF-8 → utf8', () => {
    expect(detectTextEncoding(chineseHello)).toBe('utf8')
    expect(detectTextEncoding(hello)).toBe('utf8')
  })

  it('非法 UTF-8 → 回退 gbk', () => {
    // 0xC4 0xE3 是 GBK 的「你」，在 UTF-8 中非法
    expect(detectTextEncoding(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]))).toBe('gbk')
    // 过度长编码（C0 AF）与孤立续字节亦非法
    expect(detectTextEncoding(new Uint8Array([0xc0, 0xaf]))).toBe('gbk')
    expect(detectTextEncoding(new Uint8Array([0x80]))).toBe('gbk')
    // 截断的多字节序列
    expect(detectTextEncoding(new Uint8Array([0xe4, 0xb8]))).toBe('gbk')
  })

  it('短奇数长度不误判 UTF-16', () => {
    expect(detectTextEncoding(new Uint8Array([0x61]))).toBe('utf8')
  })
})

describe('detectEol', () => {
  it('优先识别 CRLF', () => {
    expect(detectEol('a\r\nb\n')).toBe('\r\n')
  })

  it('单独 CR', () => {
    expect(detectEol('a\rb')).toBe('\r')
  })

  it('默认 LF', () => {
    expect(detectEol('a\nb')).toBe('\n')
    expect(detectEol('abc')).toBe('\n')
  })
})

describe('normalizeEol', () => {
  it('统一为 LF（默认）', () => {
    expect(normalizeEol('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })

  it('统一为 CRLF', () => {
    expect(normalizeEol('a\nb\r\nc', '\r\n')).toBe('a\r\nb\r\nc')
  })

  it('统一为 CR', () => {
    expect(normalizeEol('a\nb\r\nc', '\r')).toBe('a\rb\rc')
  })
})

describe('restoreEol', () => {
  it('LF 文本恢复为 CRLF', () => {
    expect(restoreEol('a\nb\n', '\r\n')).toBe('a\r\nb\r\n')
  })

  it('已是目标风格不重复转换', () => {
    expect(restoreEol('a\r\nb', '\r\n')).toBe('a\r\nb')
  })
})
