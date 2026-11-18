/**
 * @file file-renamer renderer 类型化 invoke 封装（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-18
 * @description scan/config/set-dir sync 通道与 apply/undo task 的提交封装，类型来自 schema.ts
 */
import type { ApplyPayload, ConfigResult, ScanResult } from '../schema'

/** 扫描目录（仅普通文件，按名称排序，超 5000 条截断） */
export function scan(dir: string): Promise<ScanResult> {
  return window.lumin.invoke('file-renamer:scan', { dir })
}

/** 提交批量重命名长任务，立即返回 taskId（三段式第一段） */
export function apply(payload: ApplyPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('file-renamer:apply', payload)
}

/** 提交撤销任务（payload 为反向 pairs，其余同 apply） */
export function undo(payload: ApplyPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('file-renamer:undo', payload)
}

/** 读取上次使用的目录（settings `lastDir`，缺省 null） */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('file-renamer:config', {})
}

/** 保存目录记忆（选择/刷新目录后即时落盘，下次打开回填） */
export function setDir(dir: string): Promise<void> {
  return window.lumin.invoke('file-renamer:set-dir', { dir })
}
