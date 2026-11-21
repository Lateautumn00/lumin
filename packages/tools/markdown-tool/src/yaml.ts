/**
 * @file YAML 互转与格式化纯函数（js-yaml）
 * @author cuilanchao
 * @date 2026-11-21
 * @description spec §3.3：YAML→JSON 美化、JSON→YAML、YAML 格式化；
 *              统一输出 2 空格缩进，语法错误带行列信息；注释与锚点在格式化后丢弃/展开。
 */
import { dump, load, YAMLException } from 'js-yaml'
import { failure, type ToolFailure } from './errors'

/** 本工具全部页签共用的输入字符上限 */
export const YAML_LIMIT = 2_000_000

export type TextOutcome = { ok: true; value: { text: string } } | ToolFailure

/** dump 选项：2 空格缩进、长行不折行、锚点展开 */
const DUMP_OPTIONS = { indent: 2, lineWidth: 120, noRefs: true } as const

/**
 * js-yaml 异常 → 「原因（第 N 行，第 M 列）」
 * @param err 捕获的异常
 */
function yamlErrorText(err: unknown): string {
  if (err instanceof YAMLException) {
    const mark = err.mark
    if (mark !== undefined && typeof mark.line === 'number' && typeof mark.column === 'number') {
      return `${err.reason}（第 ${mark.line + 1} 行，第 ${mark.column + 1} 列）`
    }
    return err.reason
  }
  return err instanceof Error ? err.message : ''
}

/**
 * 是否为「仅注释/空白」导致的空文档错误（js-yaml v5 对空流抛错）
 * @param err 捕获的异常
 */
function isEmptyDocument(err: unknown): boolean {
  return err instanceof YAMLException && err.reason.includes('input is empty')
}

/**
 * YAML 文本 → 美化 JSON
 * @param text YAML 源文本
 */
export function yamlToJson(text: string): TextOutcome {
  if (text.length > YAML_LIMIT) return failure('MD_INPUT_TOO_LONG')
  if (text.trim() === '') return { ok: true, value: { text: '' } }
  try {
    const value = load(text)
    return { ok: true, value: { text: JSON.stringify(value ?? null, null, 2) } }
  } catch (err) {
    if (isEmptyDocument(err)) return { ok: true, value: { text: 'null' } }
    return failure('MD_YAML_INVALID', yamlErrorText(err))
  }
}

/**
 * JSON 文本 → YAML
 * @param text JSON 源文本
 */
export function jsonToYaml(text: string): TextOutcome {
  if (text.length > YAML_LIMIT) return failure('MD_INPUT_TOO_LONG')
  if (text.trim() === '') return { ok: true, value: { text: '' } }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return failure('MD_JSON_INVALID', err instanceof Error ? err.message : '')
  }
  try {
    return { ok: true, value: { text: dump(parsed, DUMP_OPTIONS) } }
  } catch (err) {
    return failure('MD_YAML_INVALID', yamlErrorText(err))
  }
}

/**
 * YAML 格式化（等价 load + dump，注释丢失、锚点展开）
 * @param text YAML 源文本
 */
export function formatYaml(text: string): TextOutcome {
  if (text.length > YAML_LIMIT) return failure('MD_INPUT_TOO_LONG')
  if (text.trim() === '') return { ok: true, value: { text: '' } }
  try {
    const value = load(text)
    return { ok: true, value: { text: dump(value ?? null, DUMP_OPTIONS) } }
  } catch (err) {
    if (isEmptyDocument(err)) return { ok: true, value: { text: '' } }
    return failure('MD_YAML_INVALID', yamlErrorText(err))
  }
}
