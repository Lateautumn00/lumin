/**
 * @file 摩尔斯电码编解码纯函数（字母 / 数字 / 常用标点，无 IO）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 字母用单个空格分隔、单词用「 / 」分隔；解码遇未知码或编码遇不支持字符均报 TT_MORSE_INVALID
 */
import { checkTextSize, toolError, type TextResult } from './errors'

/** 字符 → 摩尔斯码（ITU 标准；字母/数字/常用标点） */
const ENCODE_MAP: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  '0': '-----',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
  '.': '.-.-.-',
  ',': '--..--',
  '?': '..--..',
  "'": '.----.',
  '!': '-.-.--',
  '/': '-..-.',
  '(': '-.--.',
  ')': '-.--.-',
  '&': '.-...',
  ':': '---...',
  ';': '-.-.-.',
  '=': '-...-',
  '+': '.-.-.',
  '-': '-....-',
  '_': '..--.-',
  '"': '.-..-.',
  $: '...-..-',
  '@': '.--.-.'
}

/** 摩尔斯码 → 字符（ENCODE_MAP 反向表，构建期一次生成） */
const DECODE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(ENCODE_MAP).map(([char, code]) => [code, char])
)

/** 单词分隔符（解码用正则分隔单词，兼容「/」两侧空白） */
const WORD_SPLIT = /\s*\/\s*/

/**
 * 文本 → 摩尔斯电码
 * @param text 原始文本（大小写不敏感；空白视为单词分隔）
 * @description 字母间用单空格、单词间用「 / 」；含不支持的字符时整体报错
 */
export function encodeMorse(text: string): TextResult<string> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: '' }
  const words = trimmed.split(/\s+/)
  const encodedWords: string[] = []
  for (const word of words) {
    const codes: string[] = []
    for (const char of Array.from(word)) {
      const code = ENCODE_MAP[char.toUpperCase()]
      if (code === undefined) {
        return {
          ok: false,
          error: toolError('TT_MORSE_INVALID', `不支持的字符「${char}」`)
        }
      }
      codes.push(code)
    }
    encodedWords.push(codes.join(' '))
  }
  return { ok: true, value: encodedWords.join(' / ') }
}

/**
 * 摩尔斯电码 → 文本
 * @param text 摩尔斯码（字母用空格、单词用「/」分隔）
 * @description 未知码序列报错；输出统一为大写字母
 */
export function decodeMorse(text: string): TextResult<string> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: '' }
  const words = trimmed.split(WORD_SPLIT)
  const decodedWords: string[] = []
  for (const word of words) {
    const tokens = word.trim().split(/\s+/).filter((token) => token !== '')
    const chars: string[] = []
    for (const token of tokens) {
      const char = DECODE_MAP[token]
      if (char === undefined) {
        return {
          ok: false,
          error: toolError('TT_MORSE_INVALID', `无法识别的摩尔斯码「${token}」`)
        }
      }
      chars.push(char)
    }
    decodedWords.push(chars.join(''))
  }
  return { ok: true, value: decodedWords.join(' ') }
}
