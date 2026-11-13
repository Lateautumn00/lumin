import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  HISTORY_STORAGE_KEY,
  appendEntry,
  loadHistory,
  saveHistory,
  useHistoryStore,
  type HistoryEntry,
  type StorageLike
} from './history'

function createMockStorage(): { storage: StorageLike; dump: () => string | null } {
  const map = new Map<string, string>()
  return {
    storage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value)
      }
    },
    dump: () => map.get(HISTORY_STORAGE_KEY) ?? null
  }
}

function entry(expr: string, result = '1', at = 1): HistoryEntry {
  return { expr, result, at }
}

describe('appendEntry', () => {
  it('最新条目在前', () => {
    const list = appendEntry([entry('1+1', '2')], entry('2+2', '4'))
    expect(list.map((e) => e.expr)).toEqual(['2+2', '1+1'])
  })

  it('与最新一条完全相同时不重复追加', () => {
    const base = [entry('1+1', '2')]
    expect(appendEntry(base, entry('1+1', '2'))).toEqual(base)
  })

  it('expr 或 result 不同则允许追加', () => {
    expect(appendEntry([entry('1+1', '2')], entry('1+1', '3'))).toHaveLength(2)
    expect(appendEntry([entry('1+1', '2')], entry('2+2', '2'))).toHaveLength(2)
  })

  it('超出上限丢弃最旧', () => {
    let list: HistoryEntry[] = []
    for (let i = 0; i < HISTORY_LIMIT; i += 1) list = appendEntry(list, entry(`e${i}`))
    list = appendEntry(list, entry('new'))
    expect(list).toHaveLength(HISTORY_LIMIT)
    expect(list[0]?.expr).toBe('new')
    expect(list[list.length - 1]?.expr).toBe('e1')
  })
})

describe('loadHistory / saveHistory', () => {
  it('无存储与空键回退为空数组', () => {
    expect(loadHistory(null)).toEqual([])
    const { storage } = createMockStorage()
    expect(loadHistory(storage)).toEqual([])
  })

  it('保存后可读回', () => {
    const { storage, dump } = createMockStorage()
    const list = [entry('1+1', '2', 42)]
    saveHistory(list, storage)
    expect(dump()).toContain('1+1')
    expect(loadHistory(storage)).toEqual(list)
  })

  it('损坏 JSON 回退为空数组', () => {
    const map = new Map<string, string>([[HISTORY_STORAGE_KEY, '{bad json']])
    const storage: StorageLike = { getItem: (k) => map.get(k) ?? null, setItem: () => {} }
    expect(loadHistory(storage)).toEqual([])
  })

  it('非数组 JSON 回退为空数组', () => {
    const map = new Map<string, string>([[HISTORY_STORAGE_KEY, '42']])
    const storage: StorageLike = { getItem: (k) => map.get(k) ?? null, setItem: () => {} }
    expect(loadHistory(storage)).toEqual([])
  })

  it('过滤非法条目', () => {
    const raw = JSON.stringify([
      entry('1+1', '2'),
      { expr: '', result: '2', at: 1 },
      { expr: 'x', result: 1, at: 1 },
      { expr: 'y', result: '2', at: 'now' },
      null,
      'str'
    ])
    const map = new Map<string, string>([[HISTORY_STORAGE_KEY, raw]])
    const storage: StorageLike = { getItem: (k) => map.get(k) ?? null, setItem: () => {} }
    expect(loadHistory(storage)).toEqual([entry('1+1', '2')])
  })

  it('超过上限截断', () => {
    const raw = JSON.stringify(Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => entry(`e${i}`)))
    const map = new Map<string, string>([[HISTORY_STORAGE_KEY, raw]])
    const storage: StorageLike = { getItem: (k) => map.get(k) ?? null, setItem: () => {} }
    expect(loadHistory(storage)).toHaveLength(HISTORY_LIMIT)
  })

  it('setItem 抛错（配额满）时静默', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      }
    }
    expect(() => saveHistory([entry('1')], storage)).not.toThrow()
  })
})

describe('useHistoryStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('add 追加并去重，clear 清空', () => {
    const store = useHistoryStore()
    expect(store.entries).toEqual([])
    store.add('1+1', '2')
    store.add('1+1', '2')
    expect(store.entries).toHaveLength(1)
    store.add('2+2', '4')
    expect(store.entries.map((e) => e.expr)).toEqual(['2+2', '1+1'])
    store.clear()
    expect(store.entries).toEqual([])
  })
})
