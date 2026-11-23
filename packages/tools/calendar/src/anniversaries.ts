// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- 库无内置类型：untyped 模块禁止增强，只能三斜线拉入 ambient d.ts
/// <reference path="./lunar-javascript.d.ts" />
/**
 * @file 纪念日模型/存储/下次日期算法（localStorage 持久化，对齐 unit-converter favorites 先例）
 * @author cuilanchao
 * @date 2026-11-23
 */
import { Lunar } from 'lunar-javascript'

import type { DayInfo } from './lunar'

/** 纪念日：每年重复（公历或农历，农历支持闰月降级） */
export interface Anniversary {
  id: string
  name: string
  type: 'solar' | 'lunar'
  /** 1-12 */
  month: number
  /** 1-31 */
  day: number
  /** 农历闰月生日（该年无此闰月时降级普通月） */
  leap: boolean
  /** 起始年份（可选；提供后周年日显示“N 周年”） */
  startYear?: number
}

/** 可注入存储（单测用假实现，运行时用 localStorage） */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'lumin.tool.calendar.anniversaries'

function defaultStore(): StorageLike | null {
  const candidate: unknown = globalThis.localStorage
  if (
    candidate &&
    typeof (candidate as StorageLike).getItem === 'function' &&
    typeof (candidate as StorageLike).setItem === 'function'
  ) {
    return candidate as StorageLike
  }
  return null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function sanitize(v: unknown): Anniversary | null {
  if (!isRecord(v)) return null
  const { id, name, type, month, day, leap, startYear } = v
  if (typeof id !== 'string' || id === '') return null
  if (typeof name !== 'string' || name.trim() === '') return null
  if (type !== 'solar' && type !== 'lunar') return null
  if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) return null
  if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 31) return null
  const sanitized: Anniversary = { id, name: name.trim(), type, month, day, leap: leap === true }
  if (
    typeof startYear === 'number' &&
    Number.isInteger(startYear) &&
    startYear >= 1900 &&
    startYear <= 2100
  ) {
    sanitized.startYear = startYear
  }
  return sanitized
}

/** 读取纪念日列表；缺失或损坏（非法 JSON/结构不符）回退空数组 */
export function loadAnniversaries(store?: StorageLike): Anniversary[] {
  const s = store ?? defaultStore()
  if (!s) return []
  try {
    const raw = s.getItem(STORAGE_KEY)
    if (raw === null || raw === '') return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const list: Anniversary[] = []
    for (const item of parsed) {
      const ok = sanitize(item)
      if (ok) list.push(ok)
    }
    return list
  } catch {
    return []
  }
}

/** 写回纪念日列表；返回是否成功（存储配额满等失败时调用方负责提示，数据不丢） */
export function saveAnniversaries(list: Anniversary[], store?: StorageLike): boolean {
  const s = store ?? defaultStore()
  if (!s) return false
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

function atMidnight(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function daysInFeb(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28
}

function solarOccurrence(a: Anniversary, year: number): Date {
  const day = a.month === 2 && a.day === 29 ? Math.min(29, daysInFeb(year)) : a.day
  return new Date(year, a.month - 1, day)
}

/**
 * 农历周年公历日期；降级链：闰月→普通月→29 天→28 天（月末），单测锁死
 * 构造失败返回 null
 */
function lunarOccurrence(a: Anniversary, lunarYear: number): Date | null {
  const candidates: [number, number][] = a.leap
    ? [
        [-a.month, a.day],
        [a.month, a.day],
        [a.month, 29],
        [a.month, 28]
      ]
    : [
        [a.month, a.day],
        [a.month, 29],
        [a.month, 28]
      ]
  for (const [month, day] of candidates) {
    try {
      return solarDateOf(Lunar.fromYmd(lunarYear, month, day))
    } catch {
      // 尝试下一降级候选
    }
  }
  return null
}

function solarDateOf(lunar: ReturnType<typeof Lunar.fromYmd>): Date {
  const solar = lunar.getSolar()
  return new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay())
}

/**
 * 下次周年日期（含今天）
 * - solar：今年 (m,d)，2/29 非闰年退 2/28；早于今天则明年
 * - lunar：从今天所在农历年起逐年，跨年取首个不早于今天者
 */
export function nextOccurrence(a: Anniversary, today: Date): Date {
  const base = atMidnight(today)
  if (a.type === 'solar') {
    let next = solarOccurrence(a, base.getFullYear())
    if (next.getTime() < base.getTime()) next = solarOccurrence(a, base.getFullYear() + 1)
    return next
  }
  const lunarYear = Lunar.fromDate(base).getYear()
  for (const y of [lunarYear, lunarYear + 1]) {
    const next = lunarOccurrence(a, y)
    if (next && next.getTime() >= base.getTime()) return next
  }
  // 理论不可达（ly+1 必含下次周年）；防御回退公历近似
  return solarOccurrence(a, base.getFullYear() + 1)
}

/** 日期差（自然日，含时区/DST 容错取整） */
export function daysUntil(from: Date, to: Date): number {
  const ms = atMidnight(to).getTime() - atMidnight(from).getTime()
  return Math.round(ms / 86400000)
}

/** 倒数文案：今天（有起始年则附周年数）/ 还有 N 天 */
export function formatCountdown(a: Anniversary, today: Date): string {
  const days = daysUntil(today, nextOccurrence(a, today))
  if (days === 0) {
    const years = a.startYear !== undefined ? today.getFullYear() - a.startYear : null
    if (years !== null && years > 0) return `今天 · ${years} 周年`
    return '今天'
  }
  return `还有 ${days} 天`
}

/**
 * 纪念日是否落在该日
 * - 公历：按公历月日匹配
 * - 农历：按农历月日匹配（闰月不强制——周年落在降级后的普通月时同样命中）
 */
export function matchesDay(
  a: Anniversary,
  date: Date,
  info: Pick<DayInfo, 'lunarMonth' | 'lunarDay'>
): boolean {
  if (a.type === 'solar') {
    return a.month === date.getMonth() + 1 && a.day === date.getDate()
  }
  return a.month === info.lunarMonth && a.day === info.lunarDay
}
