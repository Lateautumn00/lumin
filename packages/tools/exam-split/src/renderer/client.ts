import type {
  CropPayload,
  HalvePayload,
  OcrDetectPayload,
  OcrExportPayload,
  OpResult,
  SplitPayload
} from '../schema'

/** 任务提交回包 */
export interface SubmitResult {
  taskId: string
}

export function submitSplit(payload: SplitPayload): Promise<SubmitResult> {
  return window.lumin.invoke('exam-split:split', payload)
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

/** 页面切分（spec §11；单文件自动检测分割线，PDF 出 2N 页 / 图片出左右两张） */
export function submitHalve(payload: HalvePayload): Promise<SubmitResult> {
  return window.lumin.invoke('exam-split:halve', payload)
}

export function cancelTask(taskId: string): Promise<void> {
  return window.lumin.invoke('lumin:task:cancel', { taskId })
}

export function revealPath(path: string): Promise<void> {
  return window.lumin.revealPath(path)
}

export type { OpResult }
