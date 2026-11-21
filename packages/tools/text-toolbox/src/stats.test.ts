/**
 * @file stats.ts 单测：字符/汉字/字母/数字/词/行/字节统计
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'

import { countText } from './stats'

describe('countText', () => {
  it('空文本全为 0', () => {
    expect(countText('')).toEqual({
      chars: 0,
      charsNoSpaces: 0,
      chinese: 0,
      letters: 0,
      digits: 0,
      words: 0,
      lines: 0,
      nonEmptyLines: 0,
      bytes: 0
    })
  })

  it('中英数字混排', () => {
    expect(countText('你好 Lumin 123\n第二行')).toEqual({
      chars: 16,
      charsNoSpaces: 13,
      chinese: 5,
      letters: 5,
      digits: 3,
      words: 4,
      lines: 2,
      nonEmptyLines: 2,
      bytes: 26
    })
  })

  it('CRLF 与空行统计', () => {
    const stats = countText('a\r\n\r\n  \r\nb')
    expect(stats.lines).toBe(4)
    expect(stats.nonEmptyLines).toBe(2)
  })

  it('emoji 按码点计 1 个字符、UTF-8 4 字节', () => {
    const stats = countText('🙂')
    expect(stats.chars).toBe(1)
    expect(stats.bytes).toBe(4)
    expect(stats.letters).toBe(0)
    expect(stats.chinese).toBe(0)
  })
})
