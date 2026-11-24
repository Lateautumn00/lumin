/**
 * @file history.test.ts 处理历史 FIFO 与存量解析单测（M63）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖置顶追加、20 条截断、非法存量过滤
 */
import { describe, expect, it } from 'vitest'
import { appendHistory, parseHistory } from './history'
import type { HistoryEntry } from './schema'

/** 造历史条目 */
function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    at: 1,
    mode: 'compress',
    success: 1,
    failed: 0,
    outputDir: 'E:\\out',
    firstOutput: null,
    ...overrides
  }
}

describe('appendHistory', () => {
  it('新条目置顶且不修改原数组', () => {
    const current = [entry({ at: 2 })]
    const next = appendHistory(current, entry({ at: 3 }))
    expect(next.map((item) => item.at)).toEqual([3, 2])
    expect(current.map((item) => item.at)).toEqual([2])
  })

  it('超过 20 条截断最旧', () => {
    let list: HistoryEntry[] = []
    for (let index = 0; index < 22; index += 1) {
      list = appendHistory(list, entry({ at: index }))
    }
    expect(list).toHaveLength(20)
    expect(list[0]?.at).toBe(21)
    expect(list[19]?.at).toBe(2)
  })

  it('支持自定义上限', () => {
    const next = appendHistory([entry({ at: 1 })], entry({ at: 2 }), 1)
    expect(next.map((item) => item.at)).toEqual([2])
  })
})

describe('parseHistory', () => {
  it('非数组 → 空', () => {
    expect(parseHistory(undefined)).toEqual([])
    expect(parseHistory('x')).toEqual([])
  })

  it('逐条过滤非法项', () => {
    const good = entry({ at: 5 })
    expect(parseHistory([good, { at: -1 }, null, { mode: 'compress' }])).toEqual([good])
  })

  it('最多保留 20 条', () => {
    const raw = Array.from({ length: 25 }, (_, index) => entry({ at: index }))
    expect(parseHistory(raw)).toHaveLength(20)
    expect(parseHistory(raw)[0]?.at).toBe(0)
  })
})
