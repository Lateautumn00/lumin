/**
 * @file 正则编译/匹配/替换预览纯函数（无 IO）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 匹配收集带条数上限与零长度匹配防死循环；替换保留 String.replace 的 $1–$9 语义
 */
import { checkTextSize, toolError, type TextResult } from './errors'

/** 单条匹配信息 */
export interface RegexMatchInfo {
  /** 匹配起始下标 */
  index: number
  /** 匹配到的完整文本 */
  value: string
  /** 捕获分组（未参与匹配的分组为空串） */
  groups: string[]
}

/** 匹配收集结果 */
export interface MatchCollection {
  matches: RegexMatchInfo[]
  /** 实际匹配总数（达到上限时为已扫描数） */
  total: number
  /** 是否因上限截断 */
  truncated: boolean
}

/** 替换预览结果 */
export interface ReplaceResult {
  result: string
  count: number
  truncated: boolean
}

/** 匹配/替换计数扫描上限（防超长文本卡死渲染进程） */
export const MATCH_LIMIT_DEFAULT = 500
export const REPLACE_LIMIT_DEFAULT = 10000

/**
 * 编译正则（非法模式/标志返回结构化错误）
 * @param pattern 模式
 * @param flags 标志串（g/i/m/s/u/y）
 */
export function compileRegex(pattern: string, flags: string): TextResult<RegExp> {
  try {
    return { ok: true, value: new RegExp(pattern, flags) }
  } catch (err) {
    // RegExp 构造只会抛 SyntaxError
    return { ok: false, error: toolError('TT_REGEX_INVALID', (err as Error).message) }
  }
}

/**
 * 收集匹配（模式为空视为无匹配；无 g 标志只取首条）
 * @param pattern 模式
 * @param flags 标志串
 * @param text 测试文本
 * @param limit 收集条数上限
 */
export function collectMatches(
  pattern: string,
  flags: string,
  text: string,
  limit: number = MATCH_LIMIT_DEFAULT
): TextResult<MatchCollection> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  if (pattern === '') return { ok: true, value: { matches: [], total: 0, truncated: false } }
  const compiled = compileRegex(pattern, flags)
  if (!compiled.ok) return compiled
  const regex = compiled.value
  if (!regex.global) {
    const matched = regex.exec(text)
    if (matched === null) return { ok: true, value: { matches: [], total: 0, truncated: false } }
    return {
      ok: true,
      value: {
        matches: [toInfo(matched)],
        total: 1,
        truncated: false
      }
    }
  }
  const matches: RegexMatchInfo[] = []
  let total = 0
  let truncated = false
  regex.lastIndex = 0
  let matched: RegExpExecArray | null = regex.exec(text)
  while (matched !== null) {
    total++
    if (matches.length >= limit) {
      truncated = true
      break
    }
    matches.push(toInfo(matched))
    if (matched[0] === '') regex.lastIndex++
    matched = regex.exec(text)
  }
  return { ok: true, value: { matches, total, truncated } }
}

/**
 * 替换预览（替换串支持 $1–$9 / $&）
 * @param pattern 模式
 * @param flags 标志串
 * @param text 测试文本
 * @param replacement 替换串
 * @param limit 计数扫描上限
 */
export function replacePreview(
  pattern: string,
  flags: string,
  text: string,
  replacement: string,
  limit: number = REPLACE_LIMIT_DEFAULT
): TextResult<ReplaceResult> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  if (pattern === '') return { ok: true, value: { result: text, count: 0, truncated: false } }
  const compiled = compileRegex(pattern, flags)
  if (!compiled.ok) return compiled
  const regex = compiled.value
  if (!regex.global) {
    const first = regex.exec(text)
    return {
      ok: true,
      value: {
        result: text.replace(regex, replacement),
        count: first === null ? 0 : 1,
        truncated: false
      }
    }
  }
  let count = 0
  let truncated = false
  regex.lastIndex = 0
  let matched: RegExpExecArray | null = regex.exec(text)
  while (matched !== null) {
    count++
    if (count >= limit) {
      truncated = true
      break
    }
    if (matched[0] === '') regex.lastIndex++
    matched = regex.exec(text)
  }
  return {
    ok: true,
    value: { result: text.replace(regex, replacement), count, truncated }
  }
}

/**
 * RegExpExecArray → 匹配信息
 * @param matched exec 结果
 */
function toInfo(matched: RegExpExecArray): RegexMatchInfo {
  return {
    index: matched.index,
    value: matched[0],
    groups: matched.slice(1).map((group) => group ?? '')
  }
}
