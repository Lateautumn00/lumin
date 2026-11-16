import type {
  CropPayload,
  DeletePayload,
  MergePayload,
  OpResult,
  RotatePayload,
  SplitPayload
} from '../schema'

/** 任务提交回包 */
export interface SubmitResult {
  taskId: string
}

export function submitSplit(payload: SplitPayload): Promise<SubmitResult> {
  return window.lumin.invoke('exam-split:split', payload)
}

export function submitMerge(payload: MergePayload): Promise<SubmitResult> {
  return window.lumin.invoke('exam-split:merge', payload)
}

export function submitDelete(payload: DeletePayload): Promise<SubmitResult> {
  return window.lumin.invoke('exam-split:delete', payload)
}

export function submitRotate(payload: RotatePayload): Promise<SubmitResult> {
  return window.lumin.invoke('exam-split:rotate', payload)
}

export function submitCrop(payload: CropPayload): Promise<SubmitResult> {
  return window.lumin.invoke('exam-split:crop', payload)
}

export function cancelTask(taskId: string): Promise<void> {
  return window.lumin.invoke('lumin:task:cancel', { taskId })
}

export function revealPath(path: string): Promise<void> {
  return window.lumin.revealPath(path)
}

export type { OpResult }
