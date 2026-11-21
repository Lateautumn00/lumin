/**
 * @file renderer 类型化 invoke 封装（AGENTS §6：仅经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 七条同步 invoke（本工具无长任务，全部快速返回）
 */
import type {
  ConfigResult,
  PortKillResult,
  PortsQueryPayload,
  PortsQueryResult,
  ServerStartPayload,
  ServerStartResult,
  ServerStatusResult,
  ServerStopResult,
  SetConfigPayload
} from '../schema'

/** 查询端口占用（port 缺省为全部） */
export function portsQuery(payload: PortsQueryPayload): Promise<PortsQueryResult> {
  return window.lumin.invoke('dev-toolbox:ports-query', payload)
}

/** 结束指定 PID 进程（taskkill /T /F） */
export function portKill(pid: number): Promise<PortKillResult> {
  return window.lumin.invoke('dev-toolbox:port-kill', { pid })
}

/** 启动静态服务器 */
export function serverStart(payload: ServerStartPayload): Promise<ServerStartResult> {
  return window.lumin.invoke('dev-toolbox:server-start', payload)
}

/** 停止静态服务器 */
export function serverStop(): Promise<ServerStopResult> {
  return window.lumin.invoke('dev-toolbox:server-stop', {})
}

/** 读取服务器运行状态与最近访问 */
export function serverStatus(): Promise<ServerStatusResult> {
  return window.lumin.invoke('dev-toolbox:server-status', {})
}

/** 读取配置记忆 */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('dev-toolbox:config', {})
}

/** 保存配置记忆 */
export function setConfig(payload: SetConfigPayload): Promise<ConfigResult> {
  return window.lumin.invoke('dev-toolbox:set-config', payload)
}
