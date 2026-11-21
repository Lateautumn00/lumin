/**
 * @file morse.ts 单测：字母/数字/标点编码、单词分隔、解码往返、错误分支与体积上限
 * @author cuilanchao
 * @date 2026-11-21
 * @description 覆盖 spec §2.5 摩尔斯 Tab 的成功与错误分支
 */
import { describe, expect, it } from 'vitest'
import { decodeMorse, encodeMorse } from './morse'
import { MAX_TEXT_BYTES } from './errors'

/** 取成功值（失败时抛错便于断言） */
function valueOf(result: { ok: true; value: string } | { ok: false; error: unknown }): string {
  if (!result.ok) throw new Error('期望成功')
  return result.value
}

describe('encodeMorse', () => {
  it('字母大小写不敏感', () => {
    expect(valueOf(encodeMorse('SOS'))).toBe('... --- ...')
    expect(valueOf(encodeMorse('sos'))).toBe('... --- ...')
  })

  it('单词用「 / 」分隔、字母用单空格', () => {
    expect(valueOf(encodeMorse('HELLO WORLD'))).toBe(
      '.... . .-.. .-.. --- / .-- --- .-. .-.. -..'
    )
  })

  it('数字与常用标点', () => {
    expect(valueOf(encodeMorse('2024'))).toBe('..--- ----- ..--- ....-')
  })

  it('多个空白/换行归一为单词分隔', () => {
    expect(valueOf(encodeMorse('  A\tB\nC  '))).toBe('.- / -... / -.-.')
  })

  it('空文本返回空串', () => {
    expect(encodeMorse('   ')).toEqual({ ok: true, value: '' })
  })

  it('不支持的字符报 TT_MORSE_INVALID 并带字符', () => {
    const result = encodeMorse('A#')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('TT_MORSE_INVALID')
      expect(result.error.detail).toContain('「#」')
    }
  })

  it('超过 5MB 报 TT_TEXT_TOO_LARGE', () => {
    const big = 'A'.repeat(MAX_TEXT_BYTES + 1)
    const result = encodeMorse(big)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TT_TEXT_TOO_LARGE')
  })
})

describe('decodeMorse', () => {
  it('编码 → 解码往返（大写）', () => {
    const encoded = valueOf(encodeMorse('Lumin 2026'))
    expect(valueOf(decodeMorse(encoded))).toBe('LUMIN 2026')
  })

  it('单词分隔两侧空白容错', () => {
    expect(valueOf(decodeMorse('...   /   ---'))).toBe('S O')
  })

  it('空文本返回空串', () => {
    expect(decodeMorse('')).toEqual({ ok: true, value: '' })
  })

  it('未知码报 TT_MORSE_INVALID', () => {
    const result = decodeMorse('...---...')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('TT_MORSE_INVALID')
      expect(result.error.detail).toContain('...---...')
    }
  })

  it('超过 5MB 报 TT_TEXT_TOO_LARGE', () => {
    const big = '. '.repeat(MAX_TEXT_BYTES)
    const result = decodeMorse(big)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TT_TEXT_TOO_LARGE')
  })
})
