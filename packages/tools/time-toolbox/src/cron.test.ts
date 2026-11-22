import { describe, expect, it } from 'vitest'

import {
  buildCron,
  describeCron,
  nextCronRuns,
  parseCron,
  parseCronField,
  type CronSelection,
  type ParsedCron
} from './cron'
import { formatDateTime } from './time'

function valuesOf(result: ReturnType<typeof parseCronField>): number[] {
  if (!result.ok) throw new Error(`解析失败：${result.message}`)
  return [...result.value.values].sort((left, right) => left - right)
}

function parseOrThrow(expr: string): ParsedCron {
  const result = parseCron(expr)
  if (!result.ok) throw new Error(`解析失败：${result.message}`)
  return result.value
}

describe('parseCronField', () => {
  it('通配符与单值', () => {
    const wildcard = parseCronField('*', 0, 59)
    expect(wildcard.ok).toBe(true)
    if (wildcard.ok) {
      expect(wildcard.value.wildcard).toBe(true)
      expect(wildcard.value.values.size).toBe(60)
    }
    expect(valuesOf(parseCronField('5', 0, 59))).toEqual([5])
  })

  it('区间、列表与步长', () => {
    expect(valuesOf(parseCronField('1-5', 0, 59))).toEqual([1, 2, 3, 4, 5])
    expect(valuesOf(parseCronField('1,3,5', 0, 59))).toEqual([1, 3, 5])
    expect(valuesOf(parseCronField('*/15', 0, 59))).toEqual([0, 15, 30, 45])
    expect(valuesOf(parseCronField('10-20/5', 0, 59))).toEqual([10, 15, 20])
  })

  it('周字段 7 归一为 0', () => {
    expect(valuesOf(parseCronField('7', 0, 7, true))).toEqual([0])
    expect(valuesOf(parseCronField('0,7', 0, 7, true))).toEqual([0])
  })

  it('非法输入返回错误信息', () => {
    for (const field of ['', 'a', '60', '5-1', '*/0', '1,', '1/2/3', '1-70']) {
      const result = parseCronField(field, 0, 59)
      expect(result.ok).toBe(false)
    }
    const empty = parseCronField('', 0, 59)
    if (!empty.ok) expect(empty.message).toContain('不能为空')
  })
})

describe('parseCron', () => {
  it('解析标准 5 字段', () => {
    const parsed = parseOrThrow('*/5 * * * *')
    expect(parsed.minutes.values.size).toBe(12)
    expect(parsed.hours.wildcard).toBe(true)
    expect(parsed.daysOfWeek.wildcard).toBe(true)
  })

  it('字段数不为 5 时报错', () => {
    const result = parseCron('0 9 * *')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('5 个字段')
  })

  it('越界字段提示具体字段位', () => {
    const minute = parseCron('60 * * * *')
    expect(minute.ok).toBe(false)
    if (!minute.ok) expect(minute.message).toContain('分字段')

    const week = parseCron('* * * * 8')
    expect(week.ok).toBe(false)
    if (!week.ok) expect(week.message).toContain('周字段')
  })
})

describe('describeCron', () => {
  it('分钟步长', () => {
    expect(describeCron(parseOrThrow('*/5 * * * *'))).toBe('每 5 分钟')
    expect(describeCron(parseOrThrow('*/15 * * * *'))).toBe('每 15 分钟')
  })

  it('每天 / 每周 / 每月 / 每年', () => {
    expect(describeCron(parseOrThrow('0 9 * * *'))).toBe('每天 09:00')
    expect(describeCron(parseOrThrow('0 9 * * 1'))).toBe('每周一 09:00')
    expect(describeCron(parseOrThrow('0 0 1 * *'))).toBe('每月 1 日 00:00')
    expect(describeCron(parseOrThrow('0 0 1 1 *'))).toBe('每年 1 月 1 日 00:00')
  })

  it('连续工作日合并为区间', () => {
    expect(describeCron(parseOrThrow('0 9 * * 1-5'))).toBe('每周一至周五 09:00')
  })

  it('每小时第 N 分', () => {
    expect(describeCron(parseOrThrow('30 * * * *'))).toBe('每小时第 30 分')
  })
})

describe('nextCronRuns', () => {
  const base = new Date(2026, 0, 1, 8, 0, 0).getTime()

  it('每 5 分钟从下一分钟起算', () => {
    const runs = nextCronRuns(parseOrThrow('*/5 * * * *'), base)
    expect(runs).toHaveLength(5)
    expect(runs.map((run) => new Date(run).getMinutes())).toEqual([5, 10, 15, 20, 25])
  })

  it('每天 9 点命中当日', () => {
    const runs = nextCronRuns(parseOrThrow('0 9 * * *'), base, 1)
    expect(runs).toHaveLength(1)
    expect(formatDateTime(runs[0] ?? 0)).toBe('2026-01-01 09:00:00')
  })

  it('日与周同时受限时按「或」语义', () => {
    // 2026-01-01 为周四；0 0 1 * 1 → 每月 1 日或每周一，下一命中为 1 月 5 日（周一）
    const runs = nextCronRuns(parseOrThrow('0 0 1 * 1'), base, 1)
    expect(runs[0]).toBe(new Date(2026, 0, 5, 0, 0, 0).getTime())
  })

  it('搜索范围内无解返回空数组', () => {
    expect(nextCronRuns(parseOrThrow('0 0 30 2 *'), base, 5, 60)).toEqual([])
  })

  it('count 为 0 时返回空数组', () => {
    expect(nextCronRuns(parseOrThrow('* * * * *'), base, 0)).toEqual([])
  })
})

describe('buildCron 反向生成（M55 §4.55）', () => {
  const empty: CronSelection = {
    minutes: [],
    hours: [],
    daysOfMonth: [],
    months: [],
    daysOfWeek: []
  }

  it('空勾选 → 全通配；全量勾选 → 该字段通配', () => {
    expect(buildCron(empty)).toBe('* * * * *')
    expect(buildCron({ ...empty, minutes: Array.from({ length: 60 }, (_, index) => index) })).toBe(
      '* * * * *'
    )
    expect(buildCron({ ...empty, months: Array.from({ length: 12 }, (_, i) => i + 1) })).toBe(
      '* * * * *'
    )
  })

  it('快捷预设：每 5 分钟 / 整点 / 每天 9 点 / 每周一 9 点 / 每月 1 日', () => {
    expect(buildCron({ ...empty, minutes: Array.from({ length: 12 }, (_, i) => i * 5) })).toBe(
      '*/5 * * * *'
    )
    expect(buildCron({ ...empty, minutes: [0] })).toBe('0 * * * *')
    expect(buildCron({ ...empty, minutes: [0, 30] })).toBe('*/30 * * * *')
    expect(buildCron({ ...empty, minutes: [0], hours: [9] })).toBe('0 9 * * *')
    expect(buildCron({ ...empty, minutes: [0], hours: [9], daysOfWeek: [1] })).toBe('0 9 * * 1')
    expect(buildCron({ ...empty, minutes: [0], hours: [0], daysOfMonth: [1] })).toBe('0 0 1 * *')
  })

  it('连续段 ≥3 压缩为区间；短段与散值逐个列出', () => {
    expect(buildCron({ ...empty, hours: [9, 10, 11] })).toBe('* 9-11 * * *')
    expect(buildCron({ ...empty, hours: [9, 10] })).toBe('* 9,10 * * *')
    expect(buildCron({ ...empty, minutes: [1, 3, 5] })).toBe('1,3,5 * * * *')
    expect(buildCron({ ...empty, daysOfMonth: [1, 2, 3, 5, 6, 7] })).toBe('* * 1-3,5-7 * *')
    expect(buildCron({ ...empty, daysOfWeek: [1, 2, 3, 4, 5] })).toBe('* * * * 1-5')
  })

  it('去重升序归一与越界/非法值过滤；周末不渲染成费解步长', () => {
    expect(buildCron({ ...empty, minutes: [30, 5, 30, 5, 0] })).toBe('0,5,30 * * * *')
    expect(buildCron({ ...empty, hours: [9, 99, -1, 2.5] })).toBe('* 9 * * *')
    expect(buildCron({ ...empty, daysOfWeek: [0, 6] })).toBe('* * * * 0,6')
    expect(buildCron({ ...empty, months: [1, 6, 12] })).toBe('* * * 1,6,12 *')
    expect(buildCron({ ...empty, daysOfWeek: [0, 3, 6] })).toBe('* * * * */3')
  })

  it('往返：buildCron → parseCron 字段取值等价（空 = 通配全量）', () => {
    const range = (min: number, max: number): number[] =>
      Array.from({ length: max - min + 1 }, (_, index) => min + index)
    const norm = (values: readonly number[], min: number, max: number): number[] =>
      values.length === 0 ? range(min, max) : [...new Set(values)].sort((a, b) => a - b)
    // 周字段通配解析为 0–7（parseCronField 的 `*` 分支不做 7→0 归一，既有行为；matchesCron 只查 0–6 不受影响）
    const dowNorm = (values: readonly number[]): number[] =>
      values.length === 0 || values.length === 7
        ? range(0, 7)
        : [...new Set(values)].sort((a, b) => a - b)
    const cases: CronSelection[] = [
      { ...empty, minutes: [0, 15, 30, 45] },
      { ...empty, minutes: Array.from({ length: 60 }, (_, i) => i), hours: [9] },
      {
        ...empty,
        minutes: [0],
        hours: [9, 17],
        daysOfMonth: [1, 15],
        months: [1, 7],
        daysOfWeek: [1, 5]
      },
      { ...empty, daysOfWeek: [0, 6] },
      { ...empty, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
      { ...empty, hours: [22, 23], minutes: [30] }
    ]
    for (const selection of cases) {
      const parsed = parseOrThrow(buildCron(selection))
      const actual = [
        parsed.minutes,
        parsed.hours,
        parsed.daysOfMonth,
        parsed.months,
        parsed.daysOfWeek
      ].map((field) => [...field.values].sort((a, b) => a - b))
      expect(actual).toEqual([
        norm(selection.minutes, 0, 59),
        norm(selection.hours, 0, 23),
        norm(selection.daysOfMonth, 1, 31),
        norm(selection.months, 1, 12),
        dowNorm(selection.daysOfWeek)
      ])
    }
  })
})
