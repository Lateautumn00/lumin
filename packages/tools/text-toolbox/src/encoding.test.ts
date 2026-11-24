/**
 * @file encoding.ts 单测：Base64 UTF-8 往返（含 emoji/大文本）、非法输入、URL 编解码
 * @author cuilanchao
 * @date 2026-11-18
 * @description 覆盖 spec §2 编码 Tab 的成功与错误分支
 */
import { describe, expect, it } from 'vitest'
import {
  decodeBase64,
  decodeHex,
  decodeUnicode,
  decodeUrl,
  encodeBase64,
  encodeHex,
  encodeUnicode,
  encodeUrl
} from './encoding'
import { MAX_TEXT_BYTES } from './errors'

/** 取成功值（失败时抛错便于断言） */
function valueOf(result: { ok: true; value: string } | { ok: false; error: unknown }): string {
  if (!result.ok) throw new Error('期望成功')
  return result.value
}

describe('Base64', () => {
  it('中文与 emoji UTF-8 往返', () => {
    const text = '你好🙂 Lumin'
    const encoded = encodeBase64(text)
    expect(valueOf(encoded)).toBe(Buffer.from(text, 'utf8').toString('base64'))
    expect(decodeBase64(valueOf(encoded))).toEqual({ ok: true, value: text })
  })

  it('大文本分片编码往返（含 >0x8000 字节）', () => {
    const text = 'a'.repeat(100_000)
    const encoded = valueOf(encodeBase64(text))
    expect(decodeBase64(encoded)).toEqual({ ok: true, value: text })
  })

  it('允许换行/空格与缺失 padding', () => {
    expect(decodeBase64('aGVs\nbG8 ')).toEqual({ ok: true, value: 'hello' })
    expect(decodeBase64('aGVsbG8')).toEqual({ ok: true, value: 'hello' })
  })

  it('空串往返', () => {
    expect(encodeBase64('')).toEqual({ ok: true, value: '' })
    expect(decodeBase64('')).toEqual({ ok: true, value: '' })
  })

  it('非法字符 → TT_BASE64_INVALID', () => {
    const result = decodeBase64('!!!!')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_BASE64_INVALID')
  })

  it('长度余 1 → TT_BASE64_INVALID', () => {
    const result = decodeBase64('abcde')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_BASE64_INVALID')
  })

  it('解码结果非 UTF-8（0xFF）→ TT_BASE64_INVALID', () => {
    const result = decodeBase64('/w==')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_BASE64_INVALID')
    expect(result.error.detail).toContain('UTF-8')
  })

  it('超过 5MB → TT_TEXT_TOO_LARGE', () => {
    const result = encodeBase64('x'.repeat(MAX_TEXT_BYTES + 1))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_TEXT_TOO_LARGE')
  })
})

describe('URL', () => {
  it('component 语义编码（空格/% 保留字符）', () => {
    expect(valueOf(encodeUrl('a b&c=d?e#f'))).toBe('a%20b%26c%3Dd%3Fe%23f')
  })

  it('中文往返', () => {
    const text = '文本 工具箱/路径?x=1'
    expect(decodeUrl(valueOf(encodeUrl(text)))).toEqual({ ok: true, value: text })
  })

  it('非法百分号编码 → TT_INVALID_INPUT（detail 含首个非法处索引）', () => {
    const cases: ReadonlyArray<readonly [string, number]> = [
      ['%', 0],
      ['%E0%A4%A', 6],
      ['%ZZ', 0]
    ]
    for (const [bad, index] of cases) {
      const result = decodeUrl(bad)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.error.code).toBe('TT_INVALID_INPUT')
      expect(result.error.detail).toContain(`索引 ${index}`)
    }
  })

  it('孤立代理项无法编码 → TT_URL_INVALID', () => {
    const result = encodeUrl('\uD800')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_URL_INVALID')
    expect(result.error.detail).toContain('URI')
  })
})

describe('Hex', () => {
  it('UTF-8 字节十六进制往返（中文与 emoji）', () => {
    const text = '你好🙂'
    const encoded = encodeHex(text)
    expect(valueOf(encoded)).toBe('e4 bd a0 e5 a5 bd f0 9f 99 82')
    expect(decodeHex(valueOf(encoded))).toEqual({ ok: true, value: text })
  })

  it('解码允许空白、换行与大小写混用', () => {
    expect(decodeHex('E4 BD A0\ne5 a5 bd')).toEqual({ ok: true, value: '你好' })
    expect(decodeHex('')).toEqual({ ok: true, value: '' })
  })

  it('非法字符 → TT_HEX_INVALID', () => {
    const result = decodeHex('zz')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_HEX_INVALID')
  })

  it('奇数长度 → TT_HEX_INVALID', () => {
    const result = decodeHex('abc')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_HEX_INVALID')
    expect(result.error.detail).toContain('偶数')
  })

  it('非 UTF-8 字节 → TT_HEX_INVALID', () => {
    const result = decodeHex('ff')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_HEX_INVALID')
    expect(result.error.detail).toContain('UTF-8')
  })
})

describe('Unicode 转义', () => {
  it('中文与 emoji（代理对）往返', () => {
    const text = 'A你🙂'
    const encoded = encodeUnicode(text)
    expect(valueOf(encoded)).toBe('\\u0041\\u4F60\\uD83D\\uDE42')
    expect(decodeUnicode(valueOf(encoded))).toEqual({ ok: true, value: text })
  })

  it('解码接受小写转义并保留非转义字符', () => {
    expect(decodeUnicode('前\\u4f60后')).toEqual({ ok: true, value: '前你后' })
    expect(decodeUnicode('plain')).toEqual({ ok: true, value: 'plain' })
    expect(decodeUnicode('')).toEqual({ ok: true, value: '' })
  })

  it('转义不完整 → TT_UNICODE_INVALID', () => {
    for (const bad of ['\\u12', '\\uZZZZ', '\\u']) {
      const result = decodeUnicode(bad)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.error.code).toBe('TT_UNICODE_INVALID')
    }
  })
})
