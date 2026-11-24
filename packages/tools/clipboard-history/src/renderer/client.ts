/**
 * @file renderer 类型化 invoke 封装（AGENTS §6：仅经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-23
 * @description clipboard-history 5 同步通道：list / poll / pin / remove / clear。
 */
import type { ListResult, OkResult, PollResult } from '../schema'

/** 拉取全量历史（挂载与重试用） */
export function loadList(): Promise<ListResult> {
  return window.lumin.invoke('clipboard-history:list', {})
}

/** 单次轮询（页内 1s 定时器调用） */
export function loadPoll(): Promise<PollResult> {
  return window.lumin.invoke('clipboard-history:poll', {})
}

/** 切换置顶 */
export function togglePin(id: string): Promise<OkResult> {
  return window.lumin.invoke('clipboard-history:pin', { id })
}

/** 删除单条 */
export function deleteEntry(id: string): Promise<OkResult> {
  return window.lumin.invoke('clipboard-history:remove', { id })
}

/** 清空全部历史（含置顶） */
export function clearHistory(): Promise<OkResult> {
  return window.lumin.invoke('clipboard-history:clear', {})
}
