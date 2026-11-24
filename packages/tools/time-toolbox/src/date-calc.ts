/**
 * @file 日期计算器纯函数：区间天数（含头含尾/工作日）与日期加减（UTC 正午构造，时区无关）
 * @author cuilanchao
 * @date 2026-11-23
 * @description M60 扩展（docs/spec/time-toolbox.md M60 节）；纯函数零依赖零 IPC，
 * 非法日期/越界一律返回 null，由渲染层映射 TT_INVALID_INPUT 中文文案并恢复上一有效值
 */

/** 日期加减单位 */
export type DateCalcUnit = 'day' | 'week' | 'month' | 'year'

/** 间隔计算结果（天数一律为绝对值，negative 标记止早于起） */
export interface IntervalResult {
  /** 止早于起（展示需标注「（绝对值）」） */
  negative: boolean
  /** 总天数（含头含尾时 +1 天口径） */
  totalDays: number
  /** 自然周数（总天数 ÷7，保留 1 位小数） */
  weeks: number
  /** 工作日天数（仅跳过周六日口径） */
  weekdays: number
  /** 起始日期星期（0=周日） */
  startWeekday: number
  /** 结束日期星期（0=周日） */
  endWeekday: number
}

/** 一天毫秒数（UTC 无夏令时，等长日推进） */
const DAY_MS = 86_400_000

/** 纯日期文本模式 */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** 单次加减数量上限（spec M60：|N| ≤ 36500） */
export const MAX_DATE_STEP = 36_500

/** 星期中文标签（键为 0=周日 … 6=周六） */
const WEEKDAY_LABELS: Record<number, string> = {
  0: '星期日',
  1: '星期一',
  2: '星期二',
  3: '星期三',
  4: '星期四',
  5: '星期五',
  6: '星期六'
}

/**
 * 解析 YYYY-MM-DD → UTC 正午毫秒（正午构造规避时区/夏令时偏移坑）
 * @param text 纯日期文本
 * @returns 毫秒时间戳；格式非法或日期分量不存在（如 2023-02-29）时返回 null
 */
export function parseUtcNoon(text: string): number | null {
  const match = DATE_ONLY_PATTERN.exec(text.trim())
  if (match === null) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  // setUTCFullYear 可正确处理 0–99 年（避免 Date.UTC 将其解释为 1900+year）
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(12, 0, 0, 0)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date.getTime()
}

/**
 * UTC 毫秒 → YYYY-MM-DD（按 UTC 分量取值）
 * @param ms 毫秒时间戳
 */
export function formatUtcDate(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/**
 * 星期序号（0=周日）→ 中文星期
 * @param dow 星期序号
 */
export function weekdayLabel(dow: number): string {
  return WEEKDAY_LABELS[((dow % 7) + 7) % 7] ?? ''
}

/**
 * 日期文本 → 中文星期
 * @param text 纯日期文本；非法日期返回空串
 */
export function weekdayOf(text: string): string {
  const ms = parseUtcNoon(text)
  return ms === null ? '' : weekdayLabel(new Date(ms).getUTCDay())
}

/**
 * 计算两个日期的间隔（UTC 日历日归一）
 * @param start 起始日期 YYYY-MM-DD
 * @param end 结束日期 YYYY-MM-DD
 * @param inclusive 含头含尾（总天数与工作日均按 +1 天口径）
 * @returns 结果；任一侧非法返回 null。止早于起时取绝对值并置 negative=true
 */
export function calcInterval(
  start: string,
  end: string,
  inclusive: boolean
): IntervalResult | null {
  const startMs = parseUtcNoon(start)
  const endMs = parseUtcNoon(end)
  if (startMs === null || endMs === null) return null

  const negative = endMs < startMs
  const from = negative ? endMs : startMs
  const to = negative ? startMs : endMs
  const diffDays = Math.round((to - from) / DAY_MS)
  const totalDays = inclusive ? diffDays + 1 : diffDays

  // 工作日仅跳过周六日（不计法定节假日与调休）
  let weekdays = 0
  const first = inclusive ? from : from + DAY_MS
  for (let ms = first; ms <= to; ms += DAY_MS) {
    const dow = new Date(ms).getUTCDay()
    if (dow !== 0 && dow !== 6) weekdays += 1
  }

  return {
    negative,
    totalDays,
    weeks: Math.round((totalDays / 7) * 10) / 10,
    weekdays,
    startWeekday: new Date(startMs).getUTCDay(),
    endWeekday: new Date(endMs).getUTCDay()
  }
}

/**
 * 指定年月的天数（monthIndex 可越界，内部用 setUTCFullYear 归一）
 * @param year 年份
 * @param monthIndex 0–11 月份下标
 */
function daysInMonth(year: number, monthIndex: number): number {
  const date = new Date(0)
  date.setUTCFullYear(year, monthIndex + 1, 0) // 下月 0 日 = 本月最后一天
  return date.getUTCDate()
}

/**
 * 日期加 N 个单位（UTC 正午推进；月/年按日历进位，日溢出钳制到月末，
 * 如 1/31 + 1 月 → 2/28，闰年 → 2/29）
 * @param base 基准日期 YYYY-MM-DD
 * @param n 数量（整数，|n| ≤ 36500）
 * @param unit 单位：天 / 周 / 月 / 年
 * @returns 结果日期 YYYY-MM-DD；基准非法或数量越界返回 null
 */
export function addDays(base: string, n: number, unit: DateCalcUnit): string | null {
  const baseMs = parseUtcNoon(base)
  if (baseMs === null) return null
  if (!Number.isInteger(n) || Math.abs(n) > MAX_DATE_STEP) return null

  if (unit === 'day' || unit === 'week') {
    const step = unit === 'week' ? n * 7 : n
    return formatUtcDate(baseMs + step * DAY_MS)
  }

  const date = new Date(baseMs)
  const deltaMonths = unit === 'year' ? n * 12 : n
  const totalMonths = date.getUTCFullYear() * 12 + date.getUTCMonth() + deltaMonths
  const year = Math.floor(totalMonths / 12)
  const monthIndex = totalMonths - year * 12
  const day = Math.min(date.getUTCDate(), daysInMonth(year, monthIndex))
  const result = new Date(0)
  result.setUTCFullYear(year, monthIndex, day)
  result.setUTCHours(12, 0, 0, 0)
  return formatUtcDate(result.getTime())
}
