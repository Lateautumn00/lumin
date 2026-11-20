/**
 * @file 时间纯函数：时间戳解析/格式化、时区（Intl）、时长分解
 * @author cuilanchao
 * @date 2026-11-20
 * @description 全部同步纯函数，无副作用；时区数据来自运行时 Intl，不内置历史时区库
 */

/** 时间戳单位（秒 / 毫秒） */
export type TimestampUnit = 'seconds' | 'milliseconds'

/** 时间戳输入模式：自动识别或指定单位 */
export type TimestampMode = 'auto' | TimestampUnit

/** JS Date 可表示的最小毫秒值（±8640000000000000） */
export const MIN_DATE_MS = -8_640_000_000_000_000

/** JS Date 可表示的最大毫秒值 */
export const MAX_DATE_MS = 8_640_000_000_000_000

/** 时长分解结果（days/hours/minutes/seconds 为绝对差的进位分解） */
export interface DurationParts {
  negative: boolean
  days: number
  hours: number
  minutes: number
  seconds: number
  totalSeconds: number
  totalMinutes: number
  totalHours: number
  totalDays: number
}

/** 常用时区选项 */
export interface TimeZoneOption {
  id: string
  label: string
}

/** 内置常用 IANA 时区（顺序即展示顺序） */
export const COMMON_TIME_ZONES: readonly TimeZoneOption[] = [
  { id: 'Asia/Shanghai', label: '中国标准时间（上海）' },
  { id: 'UTC', label: '协调世界时' },
  { id: 'Asia/Tokyo', label: '日本标准时间（东京）' },
  { id: 'Europe/London', label: '英国时间（伦敦）' },
  { id: 'Europe/Paris', label: '中欧时间（巴黎）' },
  { id: 'America/New_York', label: '美国东部时间（纽约）' },
  { id: 'America/Los_Angeles', label: '美国太平洋时间（洛杉矶）' },
  { id: 'Australia/Sydney', label: '澳大利亚东部时间（悉尼）' }
]

const TIMESTAMP_PATTERN = /^-?\d+$/

/** 日期时间文本：2026-11-20T09:30[:00] 或空格分隔 */
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * 按数字位宽识别时间戳单位：去符号后 ≤11 位视为秒，否则毫秒
 * @param raw 原始输入
 */
export function detectTimestampUnit(raw: string): TimestampUnit {
  const digits = raw.trim().replace(/^[+-]/, '')
  return digits.length <= 11 ? 'seconds' : 'milliseconds'
}

/**
 * 解析时间戳为毫秒
 * @param input 仅允许整数（可带前导负号）
 * @param mode 自动识别 / 秒 / 毫秒
 * @returns 毫秒时间戳；格式非法或超出 Date 范围时返回 null
 */
export function parseTimestamp(input: string, mode: TimestampMode = 'auto'): number | null {
  const text = input.trim()
  if (!TIMESTAMP_PATTERN.test(text)) return null
  const numeric = Number(text)
  if (!Number.isSafeInteger(numeric)) return null
  const unit = mode === 'auto' ? detectTimestampUnit(text) : mode
  const milliseconds = unit === 'seconds' ? numeric * 1000 : numeric
  if (milliseconds < MIN_DATE_MS || milliseconds > MAX_DATE_MS) return null
  return milliseconds
}

/**
 * 解析本地日期时间文本为毫秒（按运行环境本地时区）
 * @param input `YYYY-MM-DDTHH:mm[:ss]` 或空格分隔
 * @returns 毫秒时间戳；格式或日期分量非法（如 2026-02-30）时返回 null
 */
export function parseLocalDateTime(input: string): number | null {
  const match = DATE_TIME_PATTERN.exec(input.trim())
  if (match === null) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = match[6] === undefined ? 0 : Number(match[6])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour > 23 || minute > 59 || second > 59) return null

  // setFullYear 可正确处理 0–99 年（避免 Date 构造器把它当 1900+year）
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(hour, minute, second, 0)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null
  }
  return date.getTime()
}

/**
 * 按时区格式化日期时间（24 小时制，固定 `YYYY-MM-DD HH:mm:ss`）
 * @param ms 毫秒时间戳
 * @param timeZone IANA 时区；缺省为本地时区
 */
export function formatDateTime(ms: number, timeZone?: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    ...(timeZone === undefined ? {} : { timeZone }),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  })
  const parts = formatter.formatToParts(new Date(ms))
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`
}

/**
 * ISO 8601（UTC）字符串
 * @param ms 毫秒时间戳
 */
export function formatIso(ms: number): string {
  return new Date(ms).toISOString()
}

/**
 * 时区 UTC 偏移（`+08:00` / `-04:00` / `+00:00`）
 * @param ms 毫秒时间戳
 * @param timeZone IANA 时区
 */
export function formatOffset(ms: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset'
  })
  const name =
    formatter.formatToParts(new Date(ms)).find((part) => part.type === 'timeZoneName')?.value ?? ''
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name)
  if (match === null) return '+00:00'
  const sign = match[1] ?? '+'
  const hours = (match[2] ?? '0').padStart(2, '0')
  const minutes = match[3] ?? '00'
  return `${sign}${hours}:${minutes}`
}

/**
 * 校验 IANA 时区名是否被当前运行时识别
 * @param timeZone 时区名（如 Asia/Shanghai）
 */
export function isValidTimeZone(timeZone: string): boolean {
  const text = timeZone.trim()
  if (text === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: text })
    return true
  } catch {
    return false
  }
}

/**
 * 分解时长（取绝对差，negative 标记方向）
 * @param diffMs 结束时间 - 开始时间（毫秒）
 */
export function formatDuration(diffMs: number): DurationParts {
  const negative = diffMs < 0
  const absolute = Math.abs(diffMs)
  const totalSeconds = absolute / 1000
  return {
    negative,
    days: Math.floor(absolute / 86_400_000),
    hours: Math.floor((absolute % 86_400_000) / 3_600_000),
    minutes: Math.floor((absolute % 3_600_000) / 60_000),
    seconds: Math.floor((absolute % 60_000) / 1000),
    totalSeconds,
    totalMinutes: totalSeconds / 60,
    totalHours: totalSeconds / 3600,
    totalDays: totalSeconds / 86_400
  }
}
