import { toolError } from './errors'

/** 解析后的单个区间（1-based，闭区间） */
export interface PageRange {
  start: number
  end: number
}

/** 单段（如 `3` 或 `7-9`）→ 页码列表；语法错/越界抛 RANGE_INVALID */
function expandToken(token: string, pageCount: number): number[] {
  const match = /^(\d+)(?:-(\d+))?$/.exec(token)
  if (match === null) throw toolError('RANGE_INVALID', token)
  const start = Number(match[1])
  const end = match[2] === undefined ? start : Number(match[2])
  if (start < 1 || end < start || end > pageCount) {
    throw toolError('RANGE_INVALID', token)
  }
  const pages: number[] = []
  for (let page = start; page <= end; page += 1) pages.push(page)
  return pages
}

/**
 * 解析为页码列表（删页/旋转/裁剪）：1-based 升序去重（spec §1 语法 `1-3,5,7-9`）。
 * `allowEmpty`：空文本返回 null（旋转/裁剪 = 全部页）；删页必填由 schema 保证。
 * 语法错、越界（>页数）、无有效页码 → RANGE_INVALID。
 */
export function parsePages(
  text: string,
  pageCount: number,
  options: { allowEmpty?: boolean } = {}
): number[] | null {
  const trimmed = text.trim()
  if (trimmed === '') {
    if (options.allowEmpty === true) return null
    throw toolError('RANGE_INVALID', text)
  }
  const pages = new Set<number>()
  for (const part of trimmed.split(',')) {
    const token = part.trim()
    if (token === '') continue
    for (const page of expandToken(token, pageCount)) pages.add(page)
  }
  if (pages.size === 0) throw toolError('RANGE_INVALID', text)
  return [...pages].sort((a, b) => a - b)
}

/**
 * 解析拆分区间：每个逗号段产出一个文件（保持书写顺序），段内页码升序。
 * 区间互相重叠 → RANGE_INVALID（detail=`overlap`）；语法错/越界同 parsePages。
 */
export function parseSplitRanges(text: string, pageCount: number): number[][] {
  const trimmed = text.trim()
  if (trimmed === '') throw toolError('RANGE_INVALID', text)
  const groups: number[][] = []
  const seen = new Set<number>()
  for (const part of trimmed.split(',')) {
    const token = part.trim()
    if (token === '') continue
    const pages = expandToken(token, pageCount)
    for (const page of pages) {
      if (seen.has(page)) throw toolError('RANGE_INVALID', 'overlap')
      seen.add(page)
    }
    groups.push(pages)
  }
  if (groups.length === 0) throw toolError('RANGE_INVALID', text)
  return groups
}

/** 连续页码 → 区间列表（拆分产物命名与展示用） */
export function toRangeList(pages: readonly number[]): PageRange[] {
  const ranges: PageRange[] = []
  for (const page of pages) {
    const last = ranges[ranges.length - 1]
    if (last !== undefined && last.end === page - 1) {
      last.end = page
    } else {
      ranges.push({ start: page, end: page })
    }
  }
  return ranges
}

/** 区间标签（spec §7.2：单页 `5`、跨页 `1-3`，直接进命名模板） */
export function rangeLabel(range: PageRange): string {
  return range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`
}
