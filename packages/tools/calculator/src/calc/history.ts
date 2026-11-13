import { defineStore } from 'pinia'

export interface HistoryEntry {
  expr: string
  result: string
  at: number
}

export const HISTORY_LIMIT = 100
export const HISTORY_STORAGE_KEY = 'lumin.tool.calculator.history'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<HistoryEntry>
  return (
    typeof entry.expr === 'string' &&
    entry.expr.length > 0 &&
    typeof entry.result === 'string' &&
    typeof entry.at === 'number'
  )
}

/** 追加历史：与最新一条完全相同则不重复；超出上限丢弃最旧 */
export function appendEntry(entries: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const head = entries[0]
  if (head !== undefined && head.expr === entry.expr && head.result === entry.result) {
    return [...entries]
  }
  return [entry, ...entries].slice(0, HISTORY_LIMIT)
}

/** 读取持久化历史：损坏/非法形状一律回退为空数组 */
export function loadHistory(storage: StorageLike | null = defaultStorage()): HistoryEntry[] {
  if (storage === null) return []
  try {
    const raw = storage.getItem(HISTORY_STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isEntry).slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

export function saveHistory(
  entries: readonly HistoryEntry[],
  storage: StorageLike | null = defaultStorage()
): void {
  if (storage === null) return
  try {
    storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)))
  } catch {
    // 配额满等存储失败静默：历史为增强功能，不阻塞计算
  }
}

export const useHistoryStore = defineStore('calculator-history', {
  state: () => ({
    entries: loadHistory()
  }),
  actions: {
    add(expr: string, result: string) {
      this.entries = appendEntry(this.entries, { expr, result, at: Date.now() })
      saveHistory(this.entries)
    },
    clear() {
      this.entries = []
      saveHistory(this.entries)
    }
  }
})
