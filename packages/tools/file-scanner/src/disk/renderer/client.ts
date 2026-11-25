/**
 * @file disk-analyzer renderer 类型化 invoke 封装（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-20
 * @description config/set-config/export-csv 同步通道与 scan 任务提交封装，类型来自 schema.ts
 */
import type {
  ConfigResult,
  ExportCsvPayload,
  ExportCsvResult,
  ScanPayload,
  SetConfigPayload
} from '../schema'

/** 提交扫描长任务，立即返回 taskId（三段式第一段） */
export function scan(payload: ScanPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('file-scanner:disk-scan', payload)
}

/** 读取上次的目录与显示阈值 */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('file-scanner:disk-config', {})
}

/** 保存目录与显示阈值 */
export function setConfig(payload: SetConfigPayload): Promise<ConfigResult> {
  return window.lumin.invoke('file-scanner:disk-set-config', payload)
}

/** 导出当前层条目与类型统计为 CSV（用户选择保存路径） */
export function exportCsv(payload: ExportCsvPayload): Promise<ExportCsvResult> {
  return window.lumin.invoke('file-scanner:disk-export-csv', payload)
}
