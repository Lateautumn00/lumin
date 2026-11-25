/**
 * @file client.ts 压缩包页签 renderer 类型化 invoke 封装（M81 并入 file-scanner，通道加 `zip-` 前缀）
 * @author cuilanchao
 * @date 2026-11-25
 * @description config/set-config 同步通道与 pack/unpack 任务提交封装，类型来自 schema.ts。
 *              入参先过 zod：既做前置校验，也把 Vue 响应式 Proxy 还原为纯对象（否则 IPC 结构化克隆报错）。
 */
import {
  packPayloadSchema,
  setConfigPayloadSchema,
  unpackPayloadSchema,
  type ConfigResult,
  type PackPayload,
  type SetConfigPayload,
  type UnpackPayload
} from '../schema'

/** 提交打包长任务，立即返回 taskId（三段式第一段） */
export function pack(payload: PackPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('file-scanner:zip-pack', packPayloadSchema.parse(payload))
}

/** 提交解压长任务，立即返回 taskId */
export function unpack(payload: UnpackPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('file-scanner:zip-unpack', unpackPayloadSchema.parse(payload))
}

/** 读取上次记忆的模式、源列表与目录 */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('file-scanner:zip-config', {})
}

/** 保存记忆（模式切换/目录变化/任务提交后调用） */
export function setConfig(payload: SetConfigPayload): Promise<ConfigResult> {
  return window.lumin.invoke('file-scanner:zip-set-config', setConfigPayloadSchema.parse(payload))
}
