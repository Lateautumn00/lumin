/**
 * @file duplicate-finder renderer 类型化 invoke 封装（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-19
 * @description config/set-config 同步通道与 scan 任务提交封装，类型来自 schema.ts
 */
import type { ConfigResult, ScanPayload, SetConfigPayload } from '../schema'

/** 提交扫描长任务，立即返回 taskId（三段式第一段） */
export function scan(payload: ScanPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('duplicate-finder:scan', payload)
}

/** 读取上次的目录与扫描选项 */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('duplicate-finder:config', {})
}

/** 保存目录与扫描选项 */
export function setConfig(payload: SetConfigPayload): Promise<ConfigResult> {
  return window.lumin.invoke('duplicate-finder:set-config', payload)
}
