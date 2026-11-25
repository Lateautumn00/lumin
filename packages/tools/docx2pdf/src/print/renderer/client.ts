/**
 * @file client.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description 打印页签 renderer 侧类型化 invoke 封装（M80 并入 docx2pdf，通道加 `print-` 前缀）。
 */
import type { SubmitResult } from '@lumin/shared'
import type { CleanupResult, PrepareResult, ShowResult, StatusResult } from '../schema'

/** 查询 soffice 可用性；传 customPath 时同时保存（spec §6） */
export function fetchStatus(customPath?: string): Promise<StatusResult> {
  return window.lumin.invoke(
    'docx2pdf:print-status',
    customPath === undefined ? {} : { customPath }
  )
}

/** 提交预检/转换任务（1..50 个文件，服务端逐份准备） */
export function submitPrepare(inputPaths: string[]): Promise<SubmitResult> {
  return window.lumin.invoke('docx2pdf:print-prepare', { inputPaths })
}

/** 提交单份打印任务（调用系统打印对话框） */
export function submitShow(jobId: string): Promise<SubmitResult> {
  return window.lumin.invoke('docx2pdf:print-show', { jobId })
}

/** 清理临时产物（不传 jobIds 清空全部） */
export function submitCleanup(jobIds?: string[]): Promise<CleanupResult> {
  return window.lumin.invoke('docx2pdf:print-cleanup', jobIds === undefined ? {} : { jobIds })
}

export function cancelTask(taskId: string): Promise<void> {
  return window.lumin.invoke('lumin:task:cancel', { taskId })
}

export type { PrepareResult, ShowResult, StatusResult }
