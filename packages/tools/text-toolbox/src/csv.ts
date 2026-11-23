/**
 * @file CSV ↔ JSON 纯函数（RFC 4180 解析核心上提 `@lumin/shared`，本层映射工具错误码）
 * @author cuilanchao
 * @date 2026-11-21
 * @description CSV 解析支持引号包裹、"" 转义、字段内换行与 CRLF 归一；JSON 仅接受扁平对象数组 → CSV
 */
import {
  parseCsv as parseCsvCore,
  type CsvDelimiter,
  type CsvParseOptions,
  type CsvTable
} from '@lumin/shared'
import { checkTextSize, toolError, type TextResult } from './errors'
import { parseJson } from './json'

export { CSV_DELIMITERS } from '@lumin/shared'
export type { CsvDelimiter, CsvParseOptions, CsvTable } from '@lumin/shared'

/** JSON → CSV 选项 */
export interface JsonToCsvOptions {
  delimiter?: CsvDelimiter
  includeHeader?: boolean
}

/** CSV 行间分隔符（RFC 4180 使用 CRLF，Excel 打开兼容性最佳） */
const LINE_BREAK = '\r\n'

/**
 * 解析 CSV 为表格（超限 → TT_TEXT_TOO_LARGE；格式错误 → TT_CSV_INVALID）
 * @param text CSV 文本
 * @param options 分隔符（默认逗号）与是否首行作表头（默认 true）
 */
export function parseCsv(text: string, options: CsvParseOptions = {}): TextResult<CsvTable> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  const parsed = parseCsvCore(text, options)
  if (!parsed.ok) return { ok: false, error: toolError('TT_CSV_INVALID', parsed.message) }
  return { ok: true, value: parsed.value }
}

/**
 * CSV → JSON 文本（2 空格缩进）
 * @param text CSV 文本
 * @param options 分隔符与是否首行作表头
 */
export function csvToJson(text: string, options: CsvParseOptions = {}): TextResult<string> {
  const table = parseCsv(text, options)
  if (!table.ok) return table
  const { headers, rows } = table.value
  if (headers === null) return { ok: true, value: JSON.stringify(rows, null, 2) }

  const objects = rows.map((row) => {
    const entry: Record<string, string> = {}
    headers.forEach((header, column) => {
      entry[header] = row[column] ?? ''
    })
    return entry
  })
  return { ok: true, value: JSON.stringify(objects, null, 2) }
}

/**
 * 字段转 CSV 单元（按需加引号并双写内部引号）
 * @param value 已转字符串的字段值
 * @param delimiter 分隔符
 */
function escapeField(value: string, delimiter: string): string {
  const needsQuote =
    value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')
  if (!needsQuote) return value
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * 基本类型值 → CSV 字段文本（null/缺失输出空串）
 * @param value JSON 字段值
 */
function valueToField(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

/**
 * JSON 对象数组 → CSV 文本（列名取所有 key 首次出现顺序）
 * @param text JSON 文本
 * @param options 分隔符与是否输出表头行
 * @description 非数组 / 非对象项 / 嵌套值 → TT_CSV_INVALID；JSON 语法错误透传 TT_JSON_INVALID
 */
export function jsonToCsv(text: string, options: JsonToCsvOptions = {}): TextResult<string> {
  const parsed = parseJson(text)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const value: unknown = parsed.value
  if (!Array.isArray(value)) {
    return { ok: false, error: toolError('TT_CSV_INVALID', 'JSON 必须是对象数组') }
  }
  const items: unknown[] = value
  if (items.length === 0) return { ok: true, value: '' }

  const columns: string[] = []
  const seen = new Set<string>()
  let shapeError: string | null = null
  for (let itemIndex = 0; itemIndex < items.length && shapeError === null; itemIndex += 1) {
    const item = items[itemIndex]
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      shapeError = `第 ${itemIndex + 1} 项不是对象`
      break
    }
    for (const [key, fieldValue] of Object.entries(item as Record<string, unknown>)) {
      if (fieldValue !== null && typeof fieldValue === 'object') {
        shapeError = `第 ${itemIndex + 1} 项字段「${key}」不是基本类型`
        break
      }
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }
  if (shapeError !== null) {
    return { ok: false, error: toolError('TT_CSV_INVALID', shapeError) }
  }

  if (columns.length === 0) {
    return { ok: false, error: toolError('TT_CSV_INVALID', '对象没有任何字段，无法生成表头') }
  }

  const delimiter = options.delimiter ?? ','
  const lines: string[] = []
  if (options.includeHeader ?? true) {
    lines.push(columns.map((column) => escapeField(column, delimiter)).join(delimiter))
  }
  for (const item of items) {
    const record = item as Record<string, unknown>
    lines.push(
      columns.map((column) => escapeField(valueToField(record[column]), delimiter)).join(delimiter)
    )
  }
  return { ok: true, value: lines.join(LINE_BREAK) }
}
