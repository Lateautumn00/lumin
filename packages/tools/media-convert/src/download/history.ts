/**
 * @file 历史记录纯函数（滚动 100 条、RUNNING→FAILED 归一，spec/media-convert-download.md §6）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 历史条目归一（应用重启后 RUNNING 视为 FAILED）与追加截断，供 node.ts 持久化前后调用
 */
import { historyEntrySchema, type HistoryEntry } from './schema'

/** 历史上限（spec §6：滚动 100 条） */
export const HISTORY_LIMIT = 100

/**
 * 从 settings 读出的原始 JSON 归一：逐条 zod 校验（坏条目丢弃）+ RUNNING → FAILED
 * （应用重启后进程已随退出终止，RUNNING 状态不可能继续）
 * @param raw settings 中存的任意值（未知形状）
 */
export function normalizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const entries: HistoryEntry[] = []
  for (const item of raw) {
    const parsed = historyEntrySchema.safeParse(item)
    if (!parsed.success) continue
    const entry = parsed.data
    entries.push(entry.status === 'RUNNING' ? { ...entry, status: 'FAILED' } : entry)
  }
  return entries
}

/**
 * 追加/更新历史条目并滚动截断：按 id 幂等替换（同任务重复写覆盖），新条目置顶
 * @param entries 现有历史
 * @param entry 新条目
 */
export function upsertHistory(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const rest = entries.filter((e) => e.id !== entry.id)
  return [entry, ...rest].slice(0, HISTORY_LIMIT)
}
