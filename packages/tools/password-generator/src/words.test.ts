import { describe, expect, it } from 'vitest'

import type { RandomSource } from './password'
import {
  EFF_ENTROPY_BITS_PER_WORD,
  EFF_WORD_COUNT,
  PASSPHRASE_COUNT_MAX,
  PASSPHRASE_WORD_COUNT_MAX,
  PASSPHRASE_WORD_COUNT_MIN,
  generatePassphrase,
  loadEffWords,
  passphraseEntropyBits,
  type PassphraseOptions
} from './words'

/** 固定字节随机源 */
function fixedSource(fill: number): RandomSource {
  return (length) => new Uint8Array(length).fill(fill)
}

const BASE_OPTIONS: PassphraseOptions = {
  wordCount: 4,
  separator: 'hyphen',
  customSeparator: '',
  capitalizeFirst: false,
  appendTwoDigits: false,
  count: 1
}

describe('loadEffWords', () => {
  it('EFF long 词表完整：7776 条、唯一、全小写 ASCII（允许连字符复合词）', async () => {
    const words = await loadEffWords()
    expect(words).toHaveLength(EFF_WORD_COUNT)
    expect(new Set(words).size).toBe(EFF_WORD_COUNT)
    for (const word of words) {
      expect(word).toMatch(/^[a-z]+(?:-[a-z]+)*$/)
    }
    expect(words).toContain('abacus')
    expect(words).toContain('drop-down')
  })
})

describe('passphraseEntropyBits', () => {
  it('词数 × log2(7776)，4 词约 51.7 bit', () => {
    expect(passphraseEntropyBits(4)).toBeCloseTo(EFF_ENTROPY_BITS_PER_WORD * 4, 6)
    expect(passphraseEntropyBits(4)).toBeCloseTo(51.7, 1)
  })

  it('无效词数或词表过小返回 0', () => {
    expect(passphraseEntropyBits(0)).toBe(0)
    expect(passphraseEntropyBits(4, 1)).toBe(0)
  })
})

describe('generatePassphrase', () => {
  it('默认 4 词连字符，固定随机源产出可断言结果', async () => {
    const words = await loadEffWords()
    const result = generatePassphrase(BASE_OPTIONS, words, fixedSource(0))
    expect(result).toEqual({
      ok: true,
      value: {
        phrases: ['abacus-abacus-abacus-abacus'],
        wordCount: 4,
        entropyBits: EFF_ENTROPY_BITS_PER_WORD * 4,
        strength: 'medium'
      }
    })
  })

  it('首词首字母大写，其余词保持小写', async () => {
    const words = await loadEffWords()
    const result = generatePassphrase(
      { ...BASE_OPTIONS, capitalizeFirst: true },
      words,
      fixedSource(0)
    )
    expect(result.ok && result.value.phrases[0]).toBe('Abacus-abacus-abacus-abacus')
  })

  it('末尾追加 2 位数字且不足补 0', async () => {
    const words = await loadEffWords()
    const result = generatePassphrase(
      { ...BASE_OPTIONS, appendTwoDigits: true },
      words,
      fixedSource(0)
    )
    expect(result.ok && result.value.phrases[0]).toBe('abacus-abacus-abacus-abacus00')
  })

  it('四种预设分隔符与自定义单字符', async () => {
    const words = await loadEffWords()
    const cases = [
      { separator: 'space' as const, expected: 'abacus abacus abacus abacus' },
      { separator: 'dot' as const, expected: 'abacus.abacus.abacus.abacus' },
      { separator: 'underscore' as const, expected: 'abacus_abacus_abacus_abacus' }
    ]
    for (const item of cases) {
      const result = generatePassphrase(
        { ...BASE_OPTIONS, separator: item.separator },
        words,
        fixedSource(0)
      )
      expect(result.ok && result.value.phrases[0]).toBe(item.expected)
    }
    const custom = generatePassphrase(
      { ...BASE_OPTIONS, separator: 'custom', customSeparator: '|' },
      words,
      fixedSource(0)
    )
    expect(custom.ok && custom.value.phrases[0]).toBe('abacus|abacus|abacus|abacus')
  })

  it('按数量生成多条口令', async () => {
    const words = await loadEffWords()
    const result = generatePassphrase({ ...BASE_OPTIONS, count: 3 }, words, fixedSource(0))
    expect(result.ok && result.value.phrases).toHaveLength(3)
  })

  it('词数越界、数量越界、词表过小、自定义分隔符非法均返回失败', async () => {
    const words = await loadEffWords()
    expect(
      generatePassphrase({ ...BASE_OPTIONS, wordCount: PASSPHRASE_WORD_COUNT_MIN - 1 }, words).ok
    ).toBe(false)
    expect(
      generatePassphrase({ ...BASE_OPTIONS, wordCount: PASSPHRASE_WORD_COUNT_MAX + 1 }, words).ok
    ).toBe(false)
    expect(generatePassphrase({ ...BASE_OPTIONS, count: 0 }, words).ok).toBe(false)
    expect(generatePassphrase({ ...BASE_OPTIONS, count: PASSPHRASE_COUNT_MAX + 1 }, words).ok).toBe(
      false
    )
    expect(generatePassphrase({ ...BASE_OPTIONS, wordCount: 2.5 }, words).ok).toBe(false)
    expect(generatePassphrase(BASE_OPTIONS, ['only']).ok).toBe(false)
    expect(
      generatePassphrase(
        { ...BASE_OPTIONS, separator: 'custom', customSeparator: '' },
        words
      ).ok
    ).toBe(false)
    expect(
      generatePassphrase(
        { ...BASE_OPTIONS, separator: 'custom', customSeparator: 'ab' },
        words
      ).ok
    ).toBe(false)
  })

  it('不修改传入词表', async () => {
    const words = await loadEffWords()
    const snapshot = [...words]
    generatePassphrase(BASE_OPTIONS, words, fixedSource(0))
    expect(words).toEqual(snapshot)
  })
})
