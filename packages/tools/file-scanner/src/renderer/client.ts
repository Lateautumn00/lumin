/**
 * @file renderer/client.ts file-scanner 类型化 invoke 封装（三页签共用）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 9 通道：hash-* / dup-* / compare-*（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）；
 *              类型来自各页签 schema（hash/duplicate/compare）
 */
import type {
  ComparePayload,
  ConfigResult as CompareConfig,
  SetConfigPayload as CompareSetConfig
} from '../compare/schema'
import type {
  ConfigResult as DuplicateConfig,
  ScanPayload,
  SetConfigPayload as DuplicateSetConfig
} from '../duplicate/schema'
import type {
  ConfigResult as HashConfig,
  HashPayload,
  SetConfigPayload as HashSetConfig
} from '../hash/schema'

// —— 文件校验（hash） ——

/** 提交哈希长任务，立即返回 taskId（三段式第一段） */
export function hashFiles(payload: HashPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('file-scanner:hash', payload)
}

/** 读取上次勾选的算法 */
export function hashConfig(): Promise<HashConfig> {
  return window.lumin.invoke('file-scanner:hash-config', {})
}

/** 保存算法勾选 */
export function setHashConfig(payload: HashSetConfig): Promise<HashConfig> {
  return window.lumin.invoke('file-scanner:hash-set-config', payload)
}

// —— 重复文件（duplicate） ——

/** 提交扫描长任务，立即返回 taskId */
export function scanDuplicates(payload: ScanPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('file-scanner:dup-scan', payload)
}

/** 读取上次的目录与扫描选项 */
export function duplicateConfig(): Promise<DuplicateConfig> {
  return window.lumin.invoke('file-scanner:dup-config', {})
}

/** 保存目录与扫描选项 */
export function setDuplicateConfig(payload: DuplicateSetConfig): Promise<DuplicateConfig> {
  return window.lumin.invoke('file-scanner:dup-set-config', payload)
}

// —— 目录对比（compare） ——

/** 提交对比长任务，立即返回 taskId */
export function compareDirectories(payload: ComparePayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('file-scanner:compare', payload)
}

/** 读取上次的左右目录与比较开关 */
export function compareConfig(): Promise<CompareConfig> {
  return window.lumin.invoke('file-scanner:compare-config', {})
}

/** 保存左右目录与比较开关 */
export function setCompareConfig(payload: CompareSetConfig): Promise<CompareConfig> {
  return window.lumin.invoke('file-scanner:compare-set-config', payload)
}
