/**
 * @file 文本字数统计纯函数（字符 / 汉字 / 字母 / 数字 / 词 / 行 / UTF-8 字节）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 字符按 Unicode 码点计数，emoji 记 1 个；行数按 CRLF/CR/LF 拆分
 */

/** 统计结果 */
export interface TextStats {
  /** 字符数（按码点，emoji 记 1） */
  chars: number
  /** 去除空白后的字符数 */
  charsNoSpaces: number
  /** 汉字数（Unicode Script=Han） */
  chinese: number
  /** 字母数 */
  letters: number
  /** 数字数 */
  digits: number
  /** 词数（空白分隔） */
  words: number
  /** 行数（空文本为 0） */
  lines: number
  /** 非空行数 */
  nonEmptyLines: number
  /** UTF-8 字节数 */
  bytes: number
}

/** 取匹配数量（无匹配为 0） */
function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

/**
 * 统计文本特征
 * @param text 待统计文本
 */
export function countText(text: string): TextStats {
  const trimmed = text.trim()
  const chars = Array.from(text).length
  const chinese = countMatches(text, /\p{Script=Han}/gu)
  return {
    chars,
    charsNoSpaces: Array.from(text.replace(/\s/g, '')).length,
    chinese,
    letters: countMatches(text, /\p{L}/gu) - chinese,
    digits: countMatches(text, /\p{N}/gu),
    words: trimmed === '' ? 0 : trimmed.split(/\s+/).length,
    lines: text === '' ? 0 : text.split(/\r\n|\r|\n/).length,
    nonEmptyLines:
      text === '' ? 0 : text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '').length,
    bytes: new TextEncoder().encode(text).length
  }
}
