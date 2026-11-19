/**
 * @file OCR 共享引擎错误（UPPER_SNAKE；码值与文案与 exam-split 既有表逐字一致）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 上提自 exam-split：保证 exam-split 行为零回归；ocr-text 在任务边界
 *              将 PDF_* 码归一为自身错误码（见各工具 node.ts）。
 */
import type { StructuredError } from '@lumin/shared'

/** ocr-kit 会抛出的结构化错误码全集 */
export const OCR_KIT_ERROR_CODES = [
  'PDF_NOT_FOUND',
  'PDF_LOCKED',
  'PDF_ENCRYPTED',
  'PDF_INVALID',
  'INVALID_PAYLOAD',
  'OCR_INPUT_INVALID',
  'MODEL_MISSING',
  'OCR_FAILED'
] as const

export type OcrErrorCode = (typeof OCR_KIT_ERROR_CODES)[number]

/** 错误码 → 中文文案（与 exam-split spec §5 同源） */
const MESSAGES: Record<OcrErrorCode, string> = {
  PDF_NOT_FOUND: '输入文件不存在，请重新选择',
  PDF_LOCKED: '文件被其他程序占用，请关闭后重试',
  PDF_ENCRYPTED: 'PDF 已加密，请先解除密码再操作',
  PDF_INVALID: '文件无法读取（可能已损坏或非 PDF 文件）',
  INVALID_PAYLOAD: '参数无效',
  OCR_INPUT_INVALID: '图片无法读取，请换一张清晰的图片',
  MODEL_MISSING: '识别模型缺失，请在设置中下载后重试',
  OCR_FAILED: '识别失败，请重试或查看详情'
}

/**
 * 构造 ocr-kit 结构化错误
 * @param code 错误码
 * @param detail 可选技术细节（errno、缺失资产名等）
 */
export function ocrToolError(code: OcrErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/** 判断错误码是否属于 ocr-kit */
export function isOcrKitErrorCode(code: string): code is OcrErrorCode {
  return (OCR_KIT_ERROR_CODES as readonly string[]).includes(code)
}
