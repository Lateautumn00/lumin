/**
 * @file JSON 格式化/压缩/校验纯函数（无 IO、无 DOM 依赖）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 解析失败时把 V8 错误消息里的 position 换算为行列，供页面定位提示
 */
import type { StructuredError } from '@lumin/shared'
import { checkTextSize, toolError } from './errors'

/** 错误位置（1 基行列，列按 UTF-16 码元计） */
export interface JsonPosition {
  line: number
  column: number
}

/** JSON 操作结果：失败时带结构化错误与（可能为 null 的）位置 */
export type JsonResult<T> =
  { ok: true; value: T } | { ok: false; error: StructuredError; position: JsonPosition | null }

/**
 * 将字符下标换算为 1 基行列
 * @param text 原始文本
 * @param index 字符下标（越界自动收敛到末尾）
 */
function locate(text: string, index: number): JsonPosition {
  const clamped = Math.max(0, Math.min(index, text.length))
  const before = text.slice(0, clamped)
  const line = before.split('\n').length
  const lastBreak = before.lastIndexOf('\n')
  const column = clamped - lastBreak
  return { line, column }
}

/**
 * 从原生 JSON 错误消息解析位置
 * @param message 原生错误消息
 * @param text 原始文本
 * @returns 有 position 时按其换算行列；无 position（如 `Unexpected end of JSON input`）定位到末尾
 */
function parseErrorPosition(message: string, text: string): JsonPosition {
  const matched = /at position (\d+)/.exec(message)
  if (matched !== null) return locate(text, Number(matched[1]))
  return locate(text, text.length)
}

/**
 * 解析 JSON（带位置信息的结构化错误）
 * @param text JSON 文本
 */
export function parseJson(text: string): JsonResult<unknown> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge, position: null }
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch (err) {
    // JSON.parse 只会抛 SyntaxError
    const raw = (err as Error).message
    const position = parseErrorPosition(raw, text)
    const detail = `第 ${position.line} 行第 ${position.column} 列：${raw}`
    return { ok: false, error: toolError('TT_JSON_INVALID', detail), position }
  }
}

/**
 * 格式化 JSON（缩进 2 或 4 空格）
 * @param text JSON 文本
 * @param indent 缩进空格数
 */
export function formatJson(text: string, indent: 2 | 4): JsonResult<string> {
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed
  return { ok: true, value: JSON.stringify(parsed.value, null, indent) }
}

/**
 * 压缩 JSON（去掉所有冗余空白）
 * @param text JSON 文本
 */
export function minifyJson(text: string): JsonResult<string> {
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed
  return { ok: true, value: JSON.stringify(parsed.value) }
}

/**
 * 仅校验 JSON 合法性（成功返回输入字节数）
 * @param text JSON 文本
 */
export function validateJson(text: string): JsonResult<{ bytes: number }> {
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed
  return { ok: true, value: { bytes: new TextEncoder().encode(text).length } }
}
