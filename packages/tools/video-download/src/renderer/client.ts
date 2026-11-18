/**
 * @file video-download renderer 类型化 invoke 封装（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-18
 * @description probe/history 等 sync 通道与 start/mark-pause 的 promise 封装，入参出参类型来自 schema.ts
 */
import type {
  HistoryEntry,
  HistoryResult,
  ProbePayload,
  ProbeResult,
  StartPayload
} from '../schema'

/** 探测视频元数据（标题/平台/时长/封面） */
export function probe(payload: ProbePayload): Promise<ProbeResult> {
  return window.lumin.invoke('video-download:probe', payload)
}

/** 提交下载长任务，立即返回 taskId（三段式第一段） */
export function start(payload: StartPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('video-download:start', payload)
}

/** 暂停意图登记（配合通用 lumin:task:cancel，区分 PAUSED/CANCELLED） */
export function markPause(payload: { taskId: string }): Promise<Record<string, never>> {
  return window.lumin.invoke('video-download:mark-pause', payload)
}

/** 读取下载历史（滚动 100 条，重启后 RUNNING 归一为 FAILED） */
export function history(): Promise<HistoryResult> {
  return window.lumin.invoke('video-download:history', {})
}

/** 清空下载历史 */
export function clearHistory(): Promise<Record<string, never>> {
  return window.lumin.invoke('video-download:history:clear', {})
}

/** 打开输出文件所在文件夹（复用壳通道，壳侧 zod 校验非空） */
export function revealPath(path: string): Promise<void> {
  return window.lumin.revealPath(path)
}

export type { HistoryEntry }
