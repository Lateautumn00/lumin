/**
 * @file folder-compare renderer 类型化 invoke 封装（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-20
 * @description config/set-config 同步通道与 compare 任务提交封装，类型来自 schema.ts
 */
import type { ComparePayload, ConfigResult, SetConfigPayload } from '../schema'

/** 提交对比长任务，立即返回 taskId（三段式第一段） */
export function compare(payload: ComparePayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('folder-compare:compare', payload)
}

/** 读取上次的左右目录与比较开关 */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('folder-compare:config', {})
}

/** 保存左右目录与比较开关 */
export function setConfig(payload: SetConfigPayload): Promise<ConfigResult> {
  return window.lumin.invoke('folder-compare:set-config', payload)
}
