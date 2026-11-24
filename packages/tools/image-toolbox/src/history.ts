/**
 * @file history.ts 处理历史 FIFO（最近 20 条）与存量解析（M63，P1-6）
 * @author cuilanchao
 * @date 2026-11-24
 * @description settings `history` 的纯函数读写：追加置顶 + 截断、非法存量过滤。
 *              与渲染层无关，便于单测（不触 Electron）。
 */
import { HISTORY_LIMIT, historyEntrySchema, type HistoryEntry } from './schema'

/**
 * 追加一条历史（置顶）并按上限截断
 * @param current 现有历史（新 → 旧）
 * @param entry 新条目
 * @param limit 保留条数（默认 20）
 */
export function appendHistory(
  current: readonly HistoryEntry[],
  entry: HistoryEntry,
  limit = HISTORY_LIMIT
): HistoryEntry[] {
  return [entry, ...current].slice(0, limit)
}

/**
 * 解析 settings 中的存量历史：逐条 zod 校验，非法项丢弃
 * @param raw settings 读出值（未知类型）
 */
export function parseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const result: HistoryEntry[] = []
  for (const item of raw) {
    const parsed = historyEntrySchema.safeParse(item)
    if (parsed.success) result.push(parsed.data)
    if (result.length >= HISTORY_LIMIT) break
  }
  return result
}
