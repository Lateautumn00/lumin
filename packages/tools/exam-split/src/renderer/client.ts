import type {
  CropPayload,
  DeletePayload,
  MergePayload,
  OcrDetectPayload,
  OcrExportPayload,
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

/** OCR 识别（spec §10.4；done 回包含识别页与自动题区） */
export function submitOcrDetect(payload: OcrDetectPayload): Promise<SubmitResult> {
  return window.lumin.invoke('exam-split:ocr-detect', payload)
}

/** OCR 导出（spec §10.4；pages = 渲染端微调后的最终边界） */
export function submitOcrExport(payload: OcrExportPayload): Promise<SubmitResult> {
  return window.lumin.invoke('exam-split:ocr-export', payload)
}

export function cancelTask(taskId: string): Promise<void> {
  return window.lumin.invoke('lumin:task:cancel', { taskId })
}

export function revealPath(path: string): Promise<void> {
  return window.lumin.revealPath(path)
}

export type { OpResult }
