import { describe, expect, it } from 'vitest'

import {
  MAX_LAPS,
  countdownTotalSeconds,
  formatClock,
  formatDuration,
  nextPhase,
  phaseLabel,
  pushLap,
  splitLap,
  type Lap
} from './clock'

describe('formatClock（秒表 mm:ss.cs / h:mm:ss）', () => {
  it('零与亚秒', () => {
    expect(formatClock(0)).toBe('00:00.00')
    expect(formatClock(1)).toBe('00:00.00')
    expect(formatClock(1234)).toBe('00:01.23')
  })

  it('分秒进借位', () => {
    expect(formatClock(61_000)).toBe('01:01.00')
    expect(formatClock(599_990)).toBe('09:59.99')
    expect(formatClock(3_599_999)).toBe('59:59.99')
  })

  it('超过 1 小时显示 h:mm:ss', () => {
    expect(formatClock(3_600_000)).toBe('1:00:00')
    expect(formatClock(3_661_000)).toBe('1:01:01')
    expect(formatClock(36_000_000)).toBe('10:00:00')
  })

  it('负数与非法值按 0 处理', () => {
    expect(formatClock(-5)).toBe('00:00.00')
    expect(formatClock(Number.NaN)).toBe('00:00.00')
  })
})

describe('formatDuration（倒计时 / 番茄钟 mm:ss / h:mm:ss）', () => {
  it('分钟级显示', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(59)).toBe('00:59')
    expect(formatDuration(65)).toBe('01:05')
    expect(formatDuration(1500)).toBe('25:00')
  })

  it('超过 1 小时显示 h:mm:ss', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3661)).toBe('1:01:01')
  })

  it('负数与非法值按 0 处理', () => {
    expect(formatDuration(-1)).toBe('00:00')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('00:00')
  })
})

describe('countdownTotalSeconds', () => {
  it('时/分/秒换算总秒数', () => {
    expect(countdownTotalSeconds({ hours: 0, minutes: 5, seconds: 0 })).toBe(300)
    expect(countdownTotalSeconds({ hours: 1, minutes: 2, seconds: 3 })).toBe(3723)
    expect(countdownTotalSeconds({ hours: 0, minutes: 0, seconds: 0 })).toBe(0)
  })
})

describe('nextPhase（番茄钟阶段流转）', () => {
  it('专注结束 → 短休并累计专注数', () => {
    expect(nextPhase({ phase: 'focus', completedFocus: 0 })).toEqual({
      phase: 'short-break',
      completedFocus: 1
    })
    expect(nextPhase({ phase: 'focus', completedFocus: 2 })).toEqual({
      phase: 'short-break',
      completedFocus: 3
    })
  })

  it('第 4 个专注结束 → 长休', () => {
    expect(nextPhase({ phase: 'focus', completedFocus: 3 })).toEqual({
      phase: 'long-break',
      completedFocus: 4
    })
    expect(nextPhase({ phase: 'focus', completedFocus: 7 })).toEqual({
      phase: 'long-break',
      completedFocus: 8
    })
  })

  it('休息结束 → 回到专注且专注数不变', () => {
    expect(nextPhase({ phase: 'short-break', completedFocus: 1 })).toEqual({
      phase: 'focus',
      completedFocus: 1
    })
    expect(nextPhase({ phase: 'long-break', completedFocus: 4 })).toEqual({
      phase: 'focus',
      completedFocus: 4
    })
  })

  it('阶段中文名', () => {
    expect(phaseLabel('focus')).toBe('专注')
    expect(phaseLabel('short-break')).toBe('短休')
    expect(phaseLabel('long-break')).toBe('长休')
  })
})

describe('splitLap / pushLap（计次）', () => {
  it('首圈分段等于累计', () => {
    expect(splitLap(1000, 0)).toEqual({ totalMs: 1000, segmentMs: 1000 })
  })

  it('后续圈分段为相邻累计差', () => {
    expect(splitLap(2500, 1000)).toEqual({ totalMs: 2500, segmentMs: 1500 })
    expect(splitLap(2600.9, 2500)).toEqual({ totalMs: 2600, segmentMs: 100 })
  })

  it('异常差值不为负', () => {
    expect(splitLap(800, 1000)).toEqual({ totalMs: 800, segmentMs: 0 })
  })

  it('pushLap 新的在上并封顶 20 条', () => {
    const laps: Lap[] = []
    const appended = pushLap(laps, { totalMs: 100, segmentMs: 100 })
    expect(appended).toHaveLength(1)
    expect(appended[0]?.totalMs).toBe(100)

    const full = Array.from({ length: MAX_LAPS }, (_unused, index) => ({
      totalMs: index,
      segmentMs: 1
    }))
    const next = pushLap(full, { totalMs: 999, segmentMs: 1 })
    expect(next).toHaveLength(MAX_LAPS)
    expect(next[0]?.totalMs).toBe(999)
    expect(next[1]?.totalMs).toBe(0)
  })
})
