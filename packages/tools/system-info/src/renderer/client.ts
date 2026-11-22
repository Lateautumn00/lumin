/**
 * @file renderer 类型化 invoke 封装（AGENTS §6：仅经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 单同步 invoke：采集系统信息快照
 */
import type { Snapshot } from '../schema'

/** 采集一次系统信息快照 */
export function snapshot(): Promise<Snapshot> {
  return window.lumin.invoke('system-info:snapshot', {})
}
