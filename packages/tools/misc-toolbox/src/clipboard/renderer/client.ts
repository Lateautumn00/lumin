/**
 * @file renderer 类型化 invoke 封装（AGENTS §6：仅经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-24
 * @description clipboard-history 7 同步通道：list / poll / pin / remove / clear / image / copy。
 */
import type { ImageResult, ListResult, OkResult, PollResult } from '../schema'

/** 拉取全量历史（挂载与重试用） */
export function loadList(): Promise<ListResult> {
  return window.lumin.invoke('misc-toolbox:clipboard-list', {})
}

/** 单次轮询（页内 1s 定时器调用） */
export function loadPoll(): Promise<PollResult> {
  return window.lumin.invoke('misc-toolbox:clipboard-poll', {})
}

/** 切换置顶 */
export function togglePin(id: string): Promise<OkResult> {
  return window.lumin.invoke('misc-toolbox:clipboard-pin', { id })
}

/** 删除单条 */
export function deleteEntry(id: string): Promise<OkResult> {
  return window.lumin.invoke('misc-toolbox:clipboard-remove', { id })
}

/** 清空全部历史（含置顶） */
export function clearHistory(): Promise<OkResult> {
  return window.lumin.invoke('misc-toolbox:clipboard-clear', {})
}

/** 读取图片原图 dataURL（打开预览时按需调用） */
export function loadImage(id: string): Promise<ImageResult> {
  return window.lumin.invoke('misc-toolbox:clipboard-image', { id })
}

/** 主进程回写图片到系统剪贴板（渲染端 clipboard API 写不了图，Electron 45 W3C 口径） */
export function copyImage(id: string): Promise<OkResult> {
  return window.lumin.invoke('misc-toolbox:clipboard-copy', { id })
}
