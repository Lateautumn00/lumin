/**
 * @file renderer 类型化 invoke 封装（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-21
 * @description config/set-config 同步通道与四个长任务提交封装，类型来自 schema.ts
 */
import type {
  ConfigResult,
  EmptyDirsPayload,
  EmptyDirsResult,
  SetConfigPayload,
  TempCleanPayload,
  TempCleanResult,
  TouchPayload,
  TouchResult,
  TreePayload,
  TreeResult
} from '../schema'

/** 提交目录树任务，立即返回 taskId（三段式第一段） */
export function tree(payload: TreePayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('fs-cleaner:tree', payload)
}

/** 提交空文件夹扫描任务 */
export function emptyDirs(payload: EmptyDirsPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('fs-cleaner:empty-dirs', payload)
}

/** 提交批量改时间任务（dryRun=true 为预演） */
export function touch(payload: TouchPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('fs-cleaner:touch', payload)
}

/** 提交临时文件扫描任务（只扫不删） */
export function tempClean(payload: TempCleanPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('fs-cleaner:temp-clean', payload)
}

/** 读取记忆的目录与选项 */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('fs-cleaner:config', {})
}

/** 保存记忆的目录与选项 */
export function setConfig(payload: SetConfigPayload): Promise<ConfigResult> {
  return window.lumin.invoke('fs-cleaner:set-config', payload)
}

/** 事件类型别名（renderer 侧复用） */
export type { EmptyDirsResult, TempCleanResult, TouchResult, TreeResult }
