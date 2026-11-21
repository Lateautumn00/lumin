import { describe, expect, it } from 'vitest'

import {
  COMMON_TIME_ZONES,
  MAX_DATE_MS,
  MIN_DATE_MS,
  countdownTo,
  detectTimestampUnit,
  diffCalendar,
  formatDateTime,
  formatDuration,
  formatIso,
  formatOffset,
  isValidTimeZone,
  parseLocalDate,
  parseLocalDateTime,
  parseTimestamp
} from './time'

/** 断言日期文本合法并返回毫秒 */
function at(text: string): number {
  const ms = parseLocalDate(text)
  if (ms === null) throw new Error(`日期非法：${text}`)
  return ms
}

describe('detectTimestampUnit', () => {
  it('10 位视为秒，13 位视为毫秒', () => {
    expect(detectTimestampUnit('1700000000')).toBe('seconds')
    expect(detectTimestampUnit('1700000000000')).toBe('milliseconds')
    expect(detectTimestampUnit('  -1700000000 ')).toBe('seconds')
    expect(detectTimestampUnit('+1700000000000')).toBe('milliseconds')
  })
})

describe('parseTimestamp', () => {
  it('自动识别秒与毫秒', () => {
    expect(parseTimestamp('1700000000')).toBe(1_700_000_000_000)
    expect(parseTimestamp('1700000000000')).toBe(1_700_000_000_000)
  })

  it('手动指定单位', () => {
    expect(parseTimestamp('1700000000', 'seconds')).toBe(1_700_000_000_000)
    expect(parseTimestamp('1700000000', 'milliseconds')).toBe(1_700_000_000)
    expect(parseTimestamp('1700000000000', 'milliseconds')).toBe(1_700_000_000_000)
  })

  it('支持 1970 前的负时间戳', () => {
    expect(parseTimestamp('-1')).toBe(-1000)
    expect(parseTimestamp('-1', 'milliseconds')).toBe(-1)
  })

  it('非法格式返回 null', () => {
    expect(parseTimestamp('')).toBeNull()
    expect(parseTimestamp('   ')).toBeNull()
    expect(parseTimestamp('12a')).toBeNull()
    expect(parseTimestamp('1.5')).toBeNull()
    expect(parseTimestamp('--1')).toBeNull()
  })

  it('超出 Date 可表示范围返回 null', () => {
    expect(parseTimestamp('99999999999999999999999')).toBeNull()
    expect(parseTimestamp('8640000000000001')).toBeNull()
    expect(parseTimestamp('8640000000000000')).toBe(MAX_DATE_MS)
    expect(parseTimestamp('-8640000000000000')).toBe(MIN_DATE_MS)
  })
})

describe('parseLocalDateTime', () => {
  it('接受 T / 空格分隔与可选秒', () => {
    const fromT = parseLocalDateTime('2026-11-20T09:30')
    expect(fromT).not.toBeNull()
    const date = new Date(fromT ?? 0)
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(10)
    expect(date.getDate()).toBe(20)
    expect(date.getHours()).toBe(9)
    expect(date.getMinutes()).toBe(30)
    expect(date.getSeconds()).toBe(0)

    const withSeconds = parseLocalDateTime('2026-01-02 03:04:05')
    expect(withSeconds).not.toBeNull()
    expect(new Date(withSeconds ?? 0).getSeconds()).toBe(5)
  })

  it('拒绝不存在的日期与缺时间', () => {
    expect(parseLocalDateTime('2026-02-30T10:00')).toBeNull()
    expect(parseLocalDateTime('2026-13-01 00:00')).toBeNull()
    expect(parseLocalDateTime('2026-11-20')).toBeNull()
    expect(parseLocalDateTime('2026-11-20T24:00')).toBeNull()
    expect(parseLocalDateTime('2026-11-20T10:60')).toBeNull()
  })
})

describe('格式化', () => {
  it('UTC 时间与 ISO 8601', () => {
    expect(formatDateTime(1_700_000_000_000, 'UTC')).toBe('2023-11-14 22:13:20')
    expect(formatIso(1_700_000_000_000)).toBe('2023-11-14T22:13:20.000Z')
  })

  it('本地时间固定为 YYYY-MM-DD HH:mm:ss', () => {
    expect(formatDateTime(1_700_000_000_000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('时区偏移', () => {
    expect(formatOffset(0, 'UTC')).toBe('+00:00')
    expect(formatOffset(1_700_000_000_000, 'Asia/Shanghai')).toBe('+08:00')
    expect(formatOffset(Date.UTC(2026, 0, 15, 12, 0, 0), 'America/New_York')).toBe('-05:00')
  })

  it('时区校验', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Mars/Base')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })

  it('内置时区列表为 8 项且 id 唯一', () => {
    expect(COMMON_TIME_ZONES).toHaveLength(8)
    expect(new Set(COMMON_TIME_ZONES.map((zone) => zone.id)).size).toBe(8)
  })
})

describe('formatDuration', () => {
  it('进位分解与总量', () => {
    const parts = formatDuration(90_061_000)
    expect(parts.negative).toBe(false)
    expect(parts.days).toBe(1)
    expect(parts.hours).toBe(1)
    expect(parts.minutes).toBe(1)
    expect(parts.seconds).toBe(1)
    expect(parts.totalSeconds).toBe(90_061)
    expect(parts.totalMinutes).toBeCloseTo(1501.016_7, 3)
    expect(parts.totalHours).toBeCloseTo(25.016_9, 3)
    expect(parts.totalDays).toBeCloseTo(1.042_4, 3)
  })

  it('负差取绝对值并标记方向', () => {
    const parts = formatDuration(-1000)
    expect(parts.negative).toBe(true)
    expect(parts.seconds).toBe(1)
  })

  it('零差全部为 0', () => {
    const parts = formatDuration(0)
    expect(parts.negative).toBe(false)
    expect(parts.days).toBe(0)
    expect(parts.totalSeconds).toBe(0)
  })

  it('不足一天的小时差', () => {
    const parts = formatDuration(3_600_000)
    expect(parts.days).toBe(0)
    expect(parts.hours).toBe(1)
    expect(parts.totalHours).toBe(1)
  })
})

describe('parseLocalDate', () => {
  it('合法日期解析为本地零点', () => {
    const ms = at('2026-11-21')
    const date = new Date(ms)
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(10)
    expect(date.getDate()).toBe(21)
    expect(date.getHours()).toBe(0)
  })

  it('非法日期与格式返回 null', () => {
    expect(parseLocalDate('2026-02-30')).toBeNull()
    expect(parseLocalDate('2026-13-01')).toBeNull()
    expect(parseLocalDate('2026-00-10')).toBeNull()
    expect(parseLocalDate('2026-1-1')).toBeNull()
    expect(parseLocalDate('2026-11-21T00:00')).toBeNull()
    expect(parseLocalDate('')).toBeNull()
  })
})

describe('diffCalendar', () => {
  it('同日与相邻日', () => {
    expect(diffCalendar(at('2026-11-21'), at('2026-11-21'))).toEqual({
      negative: false,
      years: 0,
      months: 0,
      days: 0,
      totalDays: 0
    })
    expect(diffCalendar(at('2026-11-20'), at('2026-11-21'))).toEqual({
      negative: false,
      years: 0,
      months: 0,
      days: 1,
      totalDays: 1
    })
  })

  it('跨月、跨年与闰年', () => {
    const month = diffCalendar(at('2026-01-15'), at('2026-03-20'))
    expect([month.years, month.months, month.days]).toEqual([0, 2, 5])
    expect(month.totalDays).toBe(64)

    const year = diffCalendar(at('2024-02-29'), at('2025-02-28'))
    expect([year.years, year.months, year.days]).toEqual([1, 0, 0])
    expect(year.totalDays).toBe(365)
  })

  it('月末借位按加月截断（1-31 → 3-01 = 1 个月 1 天）', () => {
    const diff = diffCalendar(at('2026-01-31'), at('2026-03-01'))
    expect([diff.years, diff.months, diff.days]).toEqual([0, 1, 1])
    expect(diff.totalDays).toBe(29)
  })

  it('结束早于开始：交换并标记 negative', () => {
    const diff = diffCalendar(at('2026-11-21'), at('2026-11-20'))
    expect(diff.negative).toBe(true)
    expect([diff.years, diff.months, diff.days]).toEqual([0, 0, 1])
    expect(diff.totalDays).toBe(1)
  })
})

describe('countdownTo', () => {
  it('未来目标：剩余天/时/分/秒', () => {
    const result = countdownTo(90_061_000, 0)
    expect(result.expired).toBe(false)
    expect(result.parts.days).toBe(1)
    expect(result.parts.hours).toBe(1)
    expect(result.parts.minutes).toBe(1)
    expect(result.parts.seconds).toBe(1)
  })

  it('目标已过：expired 且按绝对差分解', () => {
    const result = countdownTo(0, 3_600_000)
    expect(result.expired).toBe(true)
    expect(result.parts.hours).toBe(1)
  })

  it('目标等于当前：expired 且全 0', () => {
    const result = countdownTo(1_700_000_000_000, 1_700_000_000_000)
    expect(result.expired).toBe(true)
    expect(result.parts.totalSeconds).toBe(0)
  })
})
