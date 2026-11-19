/**
 * @file ranges.ts 页码区间解析（纯函数，跨工具共用）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 1-based 闭区间语法（`1-3,5,7-9`）解析为页码列表/区间分组。
 *              不抛工具错误码：失败返回 RangeResult，由调用方映射成各自的结构化错误。
 */

/** 解析后的单个区间（1-based，闭区间） */
export interface PageRange {
  /** 起始页（含） */
  start: number
  /** 结束页（含） */
  end: number
}

/** 解析失败原因：空输入 / 语法错 / 越界 / 区间重叠 */
export type RangeFailure = 'empty' | 'syntax' | 'overflow' | 'overlap'

/** 解析结果（成功取值，失败给原因与出错片段） */
export type RangeResult<T> =
  { ok: true; value: T } | { ok: false; reason: RangeFailure; token: string }

/** 失败结果构造（内部使用） */
function fail(reason: RangeFailure, token: string): RangeResult<never> {
  return { ok: false, reason, token }
}

/**
 * 单段（如 `3` 或 `7-9`）→ 页码列表；语法错/越界返回失败
 * @param token 单段文本（已 trim）
 * @param pageCount 总页数（1-based 上界）
 */
function expandToken(token: string, pageCount: number): RangeResult<number[]> {
  const match = /^(\d+)(?:-(\d+))?$/.exec(token)
  if (match === null) return fail('syntax', token)
  const start = Number(match[1])
  const end = match[2] === undefined ? start : Number(match[2])
  if (start < 1 || end < start) return fail('syntax', token)
  if (end > pageCount) return fail('overflow', token)
  const pages: number[] = []
  for (let page = start; page <= end; page += 1) pages.push(page)
  return { ok: true, value: pages }
}

/**
 * 解析为页码列表：1-based 升序去重（如删页/旋转/裁剪/导出范围）。
 * `allowEmpty`：空文本返回 null（表示「全部页」）；缺省时空文本视为失败。
 * @param text 用户输入（如 `1-3,5`）
 * @param pageCount 总页数
 * @param options allowEmpty 允许空文本表示全部页
 */
export function parsePageList(
  text: string,
  pageCount: number,
  options: { allowEmpty?: boolean } = {}
): RangeResult<number[] | null> {
  const trimmed = text.trim()
  if (trimmed === '') {
    return options.allowEmpty === true ? { ok: true, value: null } : fail('empty', text)
  }
  const pages = new Set<number>()
  for (const part of trimmed.split(',')) {
    const token = part.trim()
    if (token === '') continue
    const expanded = expandToken(token, pageCount)
    if (!expanded.ok) return expanded
    for (const page of expanded.value) pages.add(page)
  }
  if (pages.size === 0) return fail('empty', text)
  return { ok: true, value: [...pages].sort((a, b) => a - b) }
}

/**
 * 解析区间分组：每个逗号段产出一组（保持书写顺序），组内页码升序。
 * 区间互相重叠 → reason=`overlap`（token=`overlap`）。
 * @param text 用户输入（如 `1-3,5,7-8`）
 * @param pageCount 总页数
 */
export function parseRangeGroups(text: string, pageCount: number): RangeResult<number[][]> {
  const trimmed = text.trim()
  if (trimmed === '') return fail('empty', text)
  const groups: number[][] = []
  const seen = new Set<number>()
  for (const part of trimmed.split(',')) {
    const token = part.trim()
    if (token === '') continue
    const expanded = expandToken(token, pageCount)
    if (!expanded.ok) return expanded
    for (const page of expanded.value) {
      if (seen.has(page)) return fail('overlap', 'overlap')
      seen.add(page)
    }
    groups.push(expanded.value)
  }
  if (groups.length === 0) return fail('empty', text)
  return { ok: true, value: groups }
}

/**
 * 连续页码 → 区间列表（产物命名与展示用）
 * @param pages 升序页码列表
 */
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

/**
 * 区间标签：单页 `5`、跨页 `1-3`（可直接进命名模板）
 * @param range 页码区间
 */
export function rangeLabel(range: PageRange): string {
  return range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`
}
