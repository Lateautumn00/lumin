// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- 库无内置类型：untyped 模块禁止增强，只能三斜线拉入 ambient d.ts
/// <reference path="./lunar-javascript.d.ts" />
/**
 * @file 节假日查询（双轨：自维护 holidays.json 优先，HolidayUtil 内置数据兜底）
 * @author cuilanchao
 * @date 2026-11-23
 */
import { HolidayUtil } from 'lunar-javascript'

import holidaysData from './data/holidays.json'

/** 当日节假日信息；off=false 表示调休上班日 */
export interface HolidayInfo {
  name: string
  off: boolean
}

interface HolidayRange {
  start: string
  end: string
  name: string
  workdays: string[]
}

interface HolidayYearEntry {
  holidays: HolidayRange[]
}

const DATA = holidaysData as Record<string, HolidayYearEntry>

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function toYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function addDays(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** 自维护数据全量展开索引（跨年区间按覆盖到的每一天登记） */
let localIndex: Map<string, HolidayInfo> | null = null

function getLocalIndex(): Map<string, HolidayInfo> {
  if (localIndex) return localIndex
  const index = new Map<string, HolidayInfo>()
  for (const entry of Object.values(DATA)) {
    for (const range of entry.holidays) {
      let cursor = range.start
      while (cursor <= range.end) {
        index.set(cursor, { name: range.name, off: true })
        cursor = addDays(cursor, 1)
      }
      for (const workday of range.workdays) {
        index.set(workday, { name: range.name, off: false })
      }
    }
  }
  localIndex = index
  return index
}

/** 查询某日节假日；两轨均未命中返回 null（远期年份无标记，不报错） */
export function getHolidayInfo(year: number, month: number, day: number): HolidayInfo | null {
  const key = toYmd(year, month, day)
  const local = getLocalIndex().get(key)
  if (local) return local
  const holiday = HolidayUtil.getHoliday(year, month, day)
  if (!holiday) return null
  return { name: holiday.getName(), off: !holiday.isWork() }
}
