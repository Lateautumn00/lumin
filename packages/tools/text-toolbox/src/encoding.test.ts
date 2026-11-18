/**
 * @file encoding.ts 单测：Base64 UTF-8 往返（含 emoji/大文本）、非法输入、URL 编解码
 * @author cuilanchao
 * @date 2026-11-18
 * @description 覆盖 spec §2 编码 Tab 的成功与错误分支
 */
import { describe, expect, it } from 'vitest'
import { decodeBase64, decodeUrl, encodeBase64, encodeUrl } from './encoding'
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

  it('非法百分号编码 → TT_URL_INVALID', () => {
    for (const bad of ['%', '%E0%A4%A', '%ZZ']) {
      const result = decodeUrl(bad)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.error.code).toBe('TT_URL_INVALID')
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
