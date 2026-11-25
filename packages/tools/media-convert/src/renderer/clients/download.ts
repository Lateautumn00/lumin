/**
 * @file 媒体工具箱 - 下载页签 renderer 类型化 invoke 封装（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-19
 * @description probe/history/cookie:* 等 sync 通道与 start/mark-pause/cookie:import-browser 的 promise 封装，
 *              入参出参类型来自 schema.ts
 */
import type {
  CookieImportBrowserPayload,
  CookieListItem,
  CookiePlatformSchema,
  CookieSetPayload,
  HistoryEntry,
  HistoryResult,
  ProbePayload,
  ProbeResult,
  StartPayload
} from '../../download/schema'

/** 探测视频元数据（标题/平台/时长/封面） */
export function probe(payload: ProbePayload): Promise<ProbeResult> {
  return window.lumin.invoke('media-convert:download-probe', payload)
}

/** 提交下载长任务，立即返回 taskId（三段式第一段） */
export function start(payload: StartPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('media-convert:download-start', payload)
}

/** 暂停意图登记（配合通用 lumin:task:cancel，区分 PAUSED/CANCELLED） */
export function markPause(payload: { taskId: string }): Promise<Record<string, never>> {
  return window.lumin.invoke('media-convert:download-mark-pause', payload)
}

/** 读取下载历史（滚动 100 条，重启后 RUNNING 归一为 FAILED） */
export function history(): Promise<HistoryResult> {
  return window.lumin.invoke('media-convert:download-history', {})
}

/** 清空下载历史 */
export function clearHistory(): Promise<Record<string, never>> {
  return window.lumin.invoke('media-convert:download-history:clear', {})
}

// —— Cookie 管理（二期，spec §9.5） ——

/** Cookie 平台（schema 枚举） */
export type CookiePlatform = CookiePlatformSchema

/** 三平台脱敏条目列表 */
export function cookieList(): Promise<{ items: CookieListItem[] }> {
  return window.lumin.invoke('media-convert:download-cookie:list', {})
}

/** 保存粘贴的 Cookie（Header 行/Netscape/裸键值三形态） */
export function cookieSet(
  payload: CookieSetPayload
): Promise<{ cookieCount: number; dropped: number }> {
  return window.lumin.invoke('media-convert:download-cookie:set', payload)
}

/** 删除某平台 Cookie */
export function cookieRemove(payload: {
  platform: CookiePlatform
}): Promise<Record<string, never>> {
  return window.lumin.invoke('media-convert:download-cookie:remove', payload)
}

/** 从浏览器导入 Cookie（长任务，progress 推送三阶段） */
export function cookieImportBrowser(
  payload: CookieImportBrowserPayload
): Promise<{ taskId: string }> {
  return window.lumin.invoke('media-convert:download-cookie:import-browser', payload)
}

/** 打开输出文件所在文件夹（复用壳通道，壳侧 zod 校验非空） */
export function revealPath(path: string): Promise<void> {
  return window.lumin.revealPath(path)
}

export type { HistoryEntry }
