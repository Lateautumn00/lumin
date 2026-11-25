/**
 * @file Passphrase 口令短语纯函数（EFF long 词表 + 拒绝采样）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 契约见 docs/spec/password-generator.md「M55 追加节」；词表按需动态导入，
 *              随机源与拒绝采样复用 password.ts，无第三方依赖。
 *              词表来源：EFF Large Wordlist（7776 词，CC BY 3.0）。
 */

import {
  defaultRandomSource,
  randomIntBelow,
  strengthOf,
  type RandomSource,
  type Result,
  type StrengthLevel
} from './password'

/** 口令词数范围（含端点） */
export const PASSPHRASE_WORD_COUNT_MIN = 3
export const PASSPHRASE_WORD_COUNT_MAX = 10

/** 口令条数范围（含端点） */
export const PASSPHRASE_COUNT_MIN = 1
export const PASSPHRASE_COUNT_MAX = 20

/** EFF long 词表词数 */
export const EFF_WORD_COUNT = 7776

/** 每词熵（bits）≈ 12.925 */
export const EFF_ENTROPY_BITS_PER_WORD = Math.log2(EFF_WORD_COUNT)

/** 分隔符类型：连字符 / 空格 / 句点 / 下划线 / 自定义单字符 */
export type PassphraseSeparator = 'hyphen' | 'space' | 'dot' | 'underscore' | 'custom'

/** 口令生成选项 */
export interface PassphraseOptions {
  wordCount: number
  separator: PassphraseSeparator
  customSeparator: string
  capitalizeFirst: boolean
  appendTwoDigits: boolean
  count: number
}

/** 口令生成结果 */
export interface PassphraseResult {
  phrases: string[]
  wordCount: number
  entropyBits: number
  strength: StrengthLevel
}

/**
 * 按需加载 EFF long 词表（独立 chunk，首次使用口令页签才加载）
 * @returns 7776 个小写英文词
 */
export async function loadEffWords(): Promise<readonly string[]> {
  const module = await import('./eff-words.json')
  return module.default
}

/**
 * 估算口令熵（bits）= 词数 × log2(词表大小)
 * @param wordCount 词数
 * @param wordListSize 词表大小（默认 7776）
 */
export function passphraseEntropyBits(
  wordCount: number,
  wordListSize: number = EFF_WORD_COUNT
): number {
  if (wordCount <= 0 || wordListSize < 2) return 0
  return wordCount * Math.log2(wordListSize)
}

/** 解析分隔符（自定义必须是单个字符） */
function separatorOf(options: PassphraseOptions): Result<string> {
  switch (options.separator) {
    case 'hyphen':
      return { ok: true, value: '-' }
    case 'space':
      return { ok: true, value: ' ' }
    case 'dot':
      return { ok: true, value: '.' }
    case 'underscore':
      return { ok: true, value: '_' }
    case 'custom': {
      const chars = Array.from(options.customSeparator)
      if (chars.length !== 1) {
        return { ok: false, message: '自定义分隔符需为单个字符' }
      }
      return { ok: true, value: chars[0] ?? '' }
    }
  }
}

/**
 * 生成口令短语（每条含 wordCount 个词，可首词大写、末尾追加 2 位数字）
 * @param options 词数/分隔符/大小写/后缀/条数
 * @param words 词表（EFF long，7776 词）
 * @param random 随机源（默认 Web Crypto）
 */
export function generatePassphrase(
  options: PassphraseOptions,
  words: readonly string[],
  random: RandomSource = defaultRandomSource
): Result<PassphraseResult> {
  if (
    !Number.isInteger(options.wordCount) ||
    options.wordCount < PASSPHRASE_WORD_COUNT_MIN ||
    options.wordCount > PASSPHRASE_WORD_COUNT_MAX
  ) {
    return {
      ok: false,
      message: `词数需为 ${PASSPHRASE_WORD_COUNT_MIN}–${PASSPHRASE_WORD_COUNT_MAX} 的整数`
    }
  }
  if (
    !Number.isInteger(options.count) ||
    options.count < PASSPHRASE_COUNT_MIN ||
    options.count > PASSPHRASE_COUNT_MAX
  ) {
    return {
      ok: false,
      message: `数量需为 ${PASSPHRASE_COUNT_MIN}–${PASSPHRASE_COUNT_MAX} 的整数`
    }
  }
  if (words.length < 2) return { ok: false, message: '词表为空或过小' }

  const separator = separatorOf(options)
  if (!separator.ok) return separator

  const phrases: string[] = []
  for (let i = 0; i < options.count; i += 1) {
    const picked: string[] = []
    for (let j = 0; j < options.wordCount; j += 1) {
      const index = randomIntBelow(words.length, random)
      const word = words[index]
      if (word === undefined) return { ok: false, message: '词表索引越界' }
      picked.push(j === 0 && options.capitalizeFirst ? capitalizeFirst(word) : word)
    }
    let phrase = picked.join(separator.value)
    if (options.appendTwoDigits) {
      phrase += String(randomIntBelow(100, random)).padStart(2, '0')
    }
    phrases.push(phrase)
  }

  const entropyBits = passphraseEntropyBits(options.wordCount, words.length)
  return {
    ok: true,
    value: {
      phrases,
      wordCount: options.wordCount,
      entropyBits,
      strength: strengthOf(entropyBits).level
    }
  }
}

/** 首字母大写（保留其余字符，含连字符复合词） */
function capitalizeFirst(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}
