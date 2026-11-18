/**
 * @file history.ts 单测（核心纯函数，覆盖率 ≥80% 分组）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 历史归一（坏条目丢弃 / RUNNING→FAILED）与 upsert 幂等置顶滚动
 */
import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, normalizeHistory, upsertHistory } from './history'
import type { HistoryEntry } from './schema'

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'task-1',
    url: 'https://example.com/v/1',
    title: '示例视频',
    preset: 'best',
    outputDir: 'E:\\out',
    status: 'DONE',
    startedAt: 1000,
    ...overrides
  }
}

describe('normalizeHistory', () => {
  it('非数组输入返回空数组', () => {
    expect(normalizeHistory(null)).toEqual([])
    expect(normalizeHistory('nope')).toEqual([])
    expect(normalizeHistory({ id: 'x' })).toEqual([])
  })

  it('坏条目丢弃，好条目保留', () => {
    const raw = [entry(), { broken: true }, 'junk', null]
    const result = normalizeHistory(raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('task-1')
  })

  it('RUNNING → FAILED（应用重启后不可能仍在下载）', () => {
    const result = normalizeHistory([entry({ status: 'RUNNING' })])
    expect(result[0]?.status).toBe('FAILED')
  })

  it('其他状态原样保留', () => {
    const result = normalizeHistory([
      entry({ id: 'a', status: 'PAUSED' }),
      entry({ id: 'b', status: 'CANCELLED' })
    ])
    expect(result.map((e) => e.status)).toEqual(['PAUSED', 'CANCELLED'])
  })

  it('可选字段缺失通过校验（platform/outputName/endedAt 等）', () => {
    const result = normalizeHistory([
      { id: 't', url: 'https://example.com/v/1', title: '', preset: '1080p', outputDir: 'E:\\o', status: 'FAILED', startedAt: 0 }
    ])
    expect(result).toHaveLength(1)
  })
})

describe('upsertHistory', () => {
  it('新条目置顶', () => {
    const result = upsertHistory([entry({ id: 'old' })], entry({ id: 'new' }))
    expect(result.map((e) => e.id)).toEqual(['new', 'old'])
  })

  it('同 id 幂等替换（不重复、位置更新到顶部）', () => {
    const initial = [entry({ id: 'a' }), entry({ id: 'b' })]
    const result = upsertHistory(initial, entry({ id: 'b', status: 'PAUSED' }))
    expect(result.map((e) => e.id)).toEqual(['b', 'a'])
    expect(result[0]?.status).toBe('PAUSED')
  })

  it('滚动截断至上限', () => {
    const initial: HistoryEntry[] = []
    for (let i = 0; i < HISTORY_LIMIT; i++) {
      initial.push(entry({ id: `t${i}`, startedAt: i }))
    }
    const result = upsertHistory(initial, entry({ id: 'fresh' }))
    expect(result).toHaveLength(HISTORY_LIMIT)
    expect(result[0]?.id).toBe('fresh')
    // 置顶后最旧的 t99 被截断，t0 尚在
    expect(result.find((e) => e.id === 't99')).toBeUndefined()
    expect(result.find((e) => e.id === 't0')).toBeDefined()
  })
})
