import { describe, expect, it } from 'vitest'

import { describeCron, nextCronRuns, parseCron, parseCronField, type ParsedCron } from './cron'
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
