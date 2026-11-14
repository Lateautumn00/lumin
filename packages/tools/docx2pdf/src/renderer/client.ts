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

export function submitConvert(inputPath: string): Promise<SubmitResult> {
  return window.lumin.invoke('docx2pdf:convert', { inputPath })
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
