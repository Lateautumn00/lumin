/**
 * @file file-hasher renderer 类型化 invoke 封装（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-19
 * @description config/set-config 同步通道与 hash 任务提交封装，类型来自 schema.ts
 */
import type { ConfigResult, HashPayload, SetConfigPayload } from '../schema'

/** 提交哈希长任务，立即返回 taskId（三段式第一段） */
export function hashFiles(payload: HashPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('file-hasher:hash', payload)
}

/** 读取上次勾选的算法 */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('file-hasher:config', {})
}

/** 保存算法勾选 */
export function setConfig(payload: SetConfigPayload): Promise<ConfigResult> {
  return window.lumin.invoke('file-hasher:set-config', payload)
}
