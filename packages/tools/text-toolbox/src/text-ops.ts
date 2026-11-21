/**
 * @file 批量文本处理纯函数：替换 / 去空行 / 去重 / 排序 / 大小写
 * @author cuilanchao
 * @date 2026-11-21
 * @description 全部无 IO；超 5MB 返回 TT_TEXT_TOO_LARGE，非法正则返回 TT_REGEX_INVALID
 */
import { checkTextSize, toolError, type TextResult } from './errors'

/** 大小写转换模式 */
export type CaseMode = 'none' | 'upper' | 'lower' | 'title'

/** 行排序模式 */
export type SortMode = 'none' | 'asc' | 'desc'

/** 替换选项 */
export interface ReplaceOptions {
  readonly regex: boolean
  readonly caseSensitive: boolean
}

/** 行处理选项（固定执行顺序：去空行 → 大小写 → 去重 → 排序） */
export interface LineOpsOptions {
  readonly removeEmpty: boolean
  readonly dedupe: boolean
  readonly sort: SortMode
  readonly caseMode: CaseMode
}

/** 按 CRLF / CR / LF 拆行（保留末尾空行语义） */
function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}

/** 行比较：中文按本地化顺序，数字按数值大小 */
function compareLines(left: string, right: string): number {
  return left.localeCompare(right, 'zh-Hans-CN', { numeric: true })
}

/**
 * 大小写转换
 * @param text 原始文本
 * @param mode upper / lower；title 为每个单词首字母大写、其余小写
 */
export function convertCase(text: string, mode: CaseMode): string {
  if (mode === 'upper') return text.toUpperCase()
  if (mode === 'lower') return text.toLowerCase()
  if (mode === 'title') {
    return text
      .toLowerCase()
      .replace(
        /(^|[^\p{L}\p{N}])(\p{L})/gu,
        (_match, prefix: string, letter: string) => prefix + letter.toUpperCase()
      )
  }
  return text
}

/**
 * 批量文本替换
 * @param text 原始文本
 * @param find 查找内容（不可为空）
 * @param replacement 替换内容（正则模式支持 $1–$9 与 $&）
 * @param options 是否按正则、是否区分大小写
 */
export function replaceText(
  text: string,
  find: string,
  replacement: string,
  options: ReplaceOptions
): TextResult<string> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  if (find === '') return { ok: false, error: toolError('TT_REPLACE_INVALID') }

  const flags = options.caseSensitive ? 'gu' : 'giu'
  const source = options.regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let pattern: RegExp
  try {
    pattern = new RegExp(source, flags)
  } catch (err) {
    return {
      ok: false,
      error: toolError('TT_REGEX_INVALID', err instanceof Error ? err.message : String(err))
    }
  }
  return { ok: true, value: text.replace(pattern, replacement) }
}

/**
 * 行级批量处理：去空行、大小写、去重、排序（按声明顺序执行）
 * @param text 原始文本
 * @param options 处理开关
 */
export function applyLineOps(text: string, options: LineOpsOptions): string {
  if (text === '') return ''
  let lines = splitLines(text)
  if (options.removeEmpty) lines = lines.filter((line) => line.trim() !== '')
  if (options.caseMode !== 'none') {
    lines = lines.map((line) => convertCase(line, options.caseMode))
  }
  if (options.dedupe) {
    const seen = new Set<string>()
    lines = lines.filter((line) => {
      if (seen.has(line)) return false
      seen.add(line)
      return true
    })
  }
  if (options.sort === 'asc') lines = [...lines].sort(compareLines)
  if (options.sort === 'desc') lines = [...lines].sort((left, right) => compareLines(right, left))
  return lines.join('\n')
}
