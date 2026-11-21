/**
 * @file CSV ↔ JSON 纯函数（RFC 4180 引号/转义，无 IO、无 DOM 依赖）
 * @author cuilanchao
 * @date 2026-11-21
 * @description CSV 解析支持引号包裹、"" 转义、字段内换行与 CRLF 归一；JSON 仅接受扁平对象数组 → CSV
 */
import { checkTextSize, toolError, type TextResult } from './errors'
import { parseJson } from './json'

/** 支持的分隔符：逗号 / 制表符 / 分号 / 竖线 */
export const CSV_DELIMITERS = [',', '\t', ';', '|'] as const

export type CsvDelimiter = (typeof CSV_DELIMITERS)[number]

/** CSV 解析选项 */
export interface CsvParseOptions {
  delimiter?: CsvDelimiter
  hasHeader?: boolean
}

/** 解析后的表格：headers 为 null 表示无表头模式 */
export interface CsvTable {
  headers: string[] | null
  rows: string[][]
}

/** JSON → CSV 选项 */
export interface JsonToCsvOptions {
  delimiter?: CsvDelimiter
  includeHeader?: boolean
}

/** CSV 行间分隔符（RFC 4180 使用 CRLF，Excel 打开兼容性最佳） */
const LINE_BREAK = '\r\n'

/**
 * 逐字符解析 CSV 为记录表（不做列数校验）
 * @param text 原始 CSV 文本（自动去除首部 BOM）
 * @param delimiter 单字符分隔符
 * @description 空行忽略；引号未闭合 / 引号不在字段起始位置时报 TT_CSV_INVALID
 */
function parseRecords(text: string, delimiter: string): TextResult<string[][]> {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false
  let line = 1
  let index = 0

  while (index < src.length) {
    const char = src.charAt(index)
    if (inQuotes) {
      if (char === '"') {
        if (src.charAt(index + 1) === '"') {
          field += '"'
          index += 2
          continue
        }
        inQuotes = false
        index += 1
        continue
      }
      if (char === '\r' || char === '\n') {
        field += '\n'
        index += char === '\r' && src.charAt(index + 1) === '\n' ? 2 : 1
        line += 1
        continue
      }
      field += char
      index += 1
      continue
    }

    if (char === '"') {
      if (field !== '') {
        return {
          ok: false,
          error: toolError('TT_CSV_INVALID', `第 ${line} 行：引号必须位于字段开头`)
        }
      }
      inQuotes = true
      index += 1
      continue
    }

    if (char === delimiter) {
      record.push(field)
      field = ''
      index += 1
      continue
    }

    if (char === '\r' || char === '\n') {
      index += char === '\r' && src.charAt(index + 1) === '\n' ? 2 : 1
      record.push(field)
      records.push(record)
      record = []
      field = ''
      line += 1
      continue
    }

    field += char
    index += 1
  }

  if (inQuotes) {
    return { ok: false, error: toolError('TT_CSV_INVALID', `第 ${line} 行：引号未闭合`) }
  }

  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }

  // 空行解析出的单空字段记录直接忽略（含结尾换行产生的空行）
  const nonEmpty = records.filter((row) => !(row.length === 1 && row[0] === ''))
  return { ok: true, value: nonEmpty }
}

/**
 * 解析 CSV 为表格（含列数一致性与表头重复校验）
 * @param text CSV 文本
 * @param options 分隔符（默认逗号）与是否首行作表头（默认 true）
 */
export function parseCsv(text: string, options: CsvParseOptions = {}): TextResult<CsvTable> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  if (text.trim() === '') {
    return { ok: false, error: toolError('TT_CSV_INVALID', 'CSV 内容为空') }
  }

  const delimiter = options.delimiter ?? ','
  const parsed = parseRecords(text, delimiter)
  if (!parsed.ok) return parsed
  const records = parsed.value

  const hasHeader = options.hasHeader ?? true
  const first = records[0] as string[]
  const width = first.length
  for (let rowIndex = 1; rowIndex < records.length; rowIndex += 1) {
    const row = records[rowIndex] as string[]
    if (row.length !== width) {
      const expected = hasHeader ? '表头' : '首行'
      return {
        ok: false,
        error: toolError(
          'TT_CSV_INVALID',
          `第 ${rowIndex + 1} 行：列数 ${row.length} 与${expected} ${width} 不一致`
        )
      }
    }
  }

  if (!hasHeader) return { ok: true, value: { headers: null, rows: records } }

  const seen = new Set<string>()
  for (const header of first) {
    if (seen.has(header)) {
      return {
        ok: false,
        error: toolError('TT_CSV_INVALID', `表头「${header}」重复`)
      }
    }
    seen.add(header)
  }
  return { ok: true, value: { headers: first, rows: records.slice(1) } }
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
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
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
