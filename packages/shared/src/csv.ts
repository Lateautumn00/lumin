/**
 * @file CSV 解析核心（RFC 4180 引号/转义，无 IO、无 DOM 依赖）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 引号包裹、"" 转义、字段内换行与 CRLF 归一；失败返回中性 message/line，由调用方映射自身错误码。
 */

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

/** 中性失败结果：message 为可直接展示的中文描述，line 为出错行号（0 表示非行级错误） */
export interface CsvParseFailure {
  ok: false
  message: string
  line: number
}

export type CsvParseResult = { ok: true; value: CsvTable } | CsvParseFailure

function fail(message: string, line: number): CsvParseFailure {
  return { ok: false, message, line }
}

/**
 * 逐字符解析 CSV 为记录表（不做列数校验）
 * @param text 原始 CSV 文本（自动去除首部 BOM）
 * @param delimiter 单字符分隔符
 * @description 空行忽略；引号未闭合 / 引号不在字段起始位置时报错
 */
function parseRecords(
  text: string,
  delimiter: string
): { ok: true; value: string[][] } | CsvParseFailure {
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
        return fail(`第 ${line} 行：引号必须位于字段开头`, line)
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
    return fail(`第 ${line} 行：引号未闭合`, line)
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
export function parseCsv(text: string, options: CsvParseOptions = {}): CsvParseResult {
  if (text.trim() === '') return fail('CSV 内容为空', 0)

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
      return fail(
        `第 ${rowIndex + 1} 行：列数 ${row.length} 与${expected} ${width} 不一致`,
        rowIndex + 1
      )
    }
  }

  if (!hasHeader) return { ok: true, value: { headers: null, rows: records } }

  const seen = new Set<string>()
  for (const header of first) {
    if (seen.has(header)) return fail(`表头「${header}」重复`, 1)
    seen.add(header)
  }
  return { ok: true, value: { headers: first, rows: records.slice(1) } }
}
