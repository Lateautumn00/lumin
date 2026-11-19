/**
 * @file client.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description docx2pdf renderer 侧类型化 invoke 封装（只经 window.lumin 白名单通道）。
 */
import type { StatusResult } from '../schema'

/** 任务提交回包 */
export interface SubmitResult {
  taskId: string
}

export function fetchStatus(): Promise<StatusResult> {
  return window.lumin.invoke('docx2pdf:status')
}

export function setCustomPath(path: string): Promise<StatusResult> {
  return window.lumin.invoke('docx2pdf:set-path', { path })
}

/** 提交批量转换任务（1..100 个 Office 文件，服务端串行逐个转换） */
export function submitConvert(inputPaths: string[]): Promise<SubmitResult> {
  return window.lumin.invoke('docx2pdf:convert', { inputPaths })
}

export function submitInstall(): Promise<SubmitResult> {
  return window.lumin.invoke('docx2pdf:install', {})
}

export function cancelTask(taskId: string): Promise<void> {
  return window.lumin.invoke('lumin:task:cancel', { taskId })
}

export function revealPath(path: string): Promise<void> {
  return window.lumin.revealPath(path)
}
