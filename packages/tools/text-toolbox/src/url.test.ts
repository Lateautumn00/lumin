/**
 * @file URL 编码（M60）单测：组件级 / 完整模式往返、RFC 3986 锚点、非法 % 定位与多重编解码
 * @author cuilanchao
 * @date 2026-11-23
 * @description 覆盖 spec §7.2 验收锚点（纯函数，无 IO）
 */
import { describe, expect, it } from 'vitest'
import { decodeUrl, encodeUrl } from './encoding'
import { errorMessage } from './errors'

describe('URL 编码（M60）', () => {
  it('组件级与完整模式编码后均可往返（中文 / 空格 / & =）', () => {
    const text = '你好 Lumin?x=1&y=2'
    for (const mode of ['component', 'full'] as const) {
      const encoded = encodeUrl(text, mode)
      expect(encoded.ok).toBe(true)
      if (!encoded.ok) continue
      expect(decodeUrl(encoded.value)).toEqual({ ok: true, value: text })
    }
  })

  it("完整模式对 !'()* 追加百分号编码（RFC 3986 锚点）", () => {
    expect(encodeUrl("!'()*", 'full')).toEqual({ ok: true, value: '%21%27%28%29%2A' })
    expect(encodeUrl("!'()*")).toEqual({ ok: true, value: "!'()*" })
    const text = "路径/'()*!"
    const full = encodeUrl(text, 'full')
    expect(full.ok).toBe(true)
    if (!full.ok) return
    expect(decodeUrl(full.value)).toEqual({ ok: true, value: text })
  })

  it('非法 % 序列 → TT_INVALID_INPUT，detail 含首个非法处索引', () => {
    const cases: ReadonlyArray<readonly [string, number]> = [
      ['%', 0],
      ['%zz', 0],
      ['abc%2', 3],
      ['%E0%A4%A', 6],
      ['a%20b%', 5]
    ]
    for (const [bad, index] of cases) {
      const result = decodeUrl(bad)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.error.code).toBe('TT_INVALID_INPUT')
      expect(result.error.detail).toContain(`索引 ${index}`)
      expect(errorMessage(result.error.code)).toBe('输入格式不正确，请检查后重试')
    }
  })

  it('合法 %xx 但非 UTF-8 字节 → TT_URL_INVALID', () => {
    const result = decodeUrl('%FF')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_URL_INVALID')
  })

  it('多重编解码：编码两次后解码两次还原', () => {
    const text = '你好 ?x=1'
    const once = encodeUrl(text)
    expect(once.ok).toBe(true)
    if (!once.ok) return
    const twice = encodeUrl(once.value)
    expect(twice.ok).toBe(true)
    if (!twice.ok) return
    const firstDecode = decodeUrl(twice.value)
    expect(firstDecode.ok).toBe(true)
    if (!firstDecode.ok) return
    expect(decodeUrl(firstDecode.value)).toEqual({ ok: true, value: text })
  })
})
