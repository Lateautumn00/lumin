/**
 * @file renderer 侧类型化 IPC 客户端（通道 text-editor:{action}）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 仅封装 invoke，不复制 shared 的类型；结果类型由 schema 推导。
 */
import type {
  OpenPayload,
  OpenResult,
  SaveAsPayload,
  SaveAsResult,
  SavePayload,
  SaveResult
} from '../schema'

/**
 * 打开文本文件（同步 IPC，主进程负责编码/EOL 判定）
 * @param payload 文件路径
 */
export function open(payload: OpenPayload): Promise<OpenResult> {
  return window.lumin.invoke<OpenResult>('text-editor:open', payload)
}

/**
 * 保存到现有路径（expectedMtimeMs 冲突时需 force）
 * @param payload 保存参数
 */
export function save(payload: SavePayload): Promise<SaveResult> {
  return window.lumin.invoke<SaveResult>('text-editor:save', payload)
}

/**
 * 另存为（dir + name，目标已存在时 TE_FILE_EXISTS）
 * @param payload 另存参数
 */
export function saveAs(payload: SaveAsPayload): Promise<SaveAsResult> {
  return window.lumin.invoke<SaveAsResult>('text-editor:save-as', payload)
}
