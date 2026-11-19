/**
 * @file ocr-text 工具错误码（UPPER_SNAKE；文案见 docs/spec/ocr-text.md §6）
 * @author cuilanchao
 * @date 2026-11-19
 * @description renderer 与 main 共用；本模块只依赖 @lumin/shared，不得引入 node-kit。
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

export const OCR_TEXT_ERROR_CODES = [
  'OCR_INVALID_PAYLOAD',
  'OCR_FILE_NOT_FOUND',
  'OCR_FILE_LOCKED',
  'OCR_IMAGE_TOO_LARGE',
  'OCR_INPUT_INVALID',
  'OCR_NO_TEXT',
  'MODEL_MISSING',
  'OCR_FAILED',
  'OP_TIMEOUT',
  'OUTPUT_WRITE_FAILED',
  'CANCELLED'
] as const

export type OcrTextErrorCode = (typeof OCR_TEXT_ERROR_CODES)[number]

const MESSAGES: Record<OcrTextErrorCode, string> = {
  OCR_INVALID_PAYLOAD: '参数无效',
  OCR_FILE_NOT_FOUND: '图片不存在，请重新选择',
  OCR_FILE_LOCKED: '图片被其他程序占用，请关闭后重试',
  OCR_IMAGE_TOO_LARGE: '图片超过 20MB，请压缩后重试',
  OCR_INPUT_INVALID: '图片无法读取，请换一张清晰的图片',
  OCR_NO_TEXT: '未识别到文字，请换更清晰的图片',
  MODEL_MISSING: '识别模型缺失，请重新安装应用后重试',
  OCR_FAILED: '识别失败，请重试或查看详情',
  OP_TIMEOUT: '处理超时（120 秒），已终止',
  OUTPUT_WRITE_FAILED: '无法写出 TXT，请检查目录权限与剩余空间',
  CANCELLED: '已取消'
}

/** 可重试错误码（renderer 据此显示「重试」） */
const RETRYABLE = new Set<OcrTextErrorCode>([
  'OCR_FILE_LOCKED',
  'OCR_NO_TEXT',
  'MODEL_MISSING',
  'OCR_FAILED',
  'OP_TIMEOUT',
  'OUTPUT_WRITE_FAILED'
])

export function toolError(code: OcrTextErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as OcrTextErrorCode)
}

/** 判断抛出物是否已是结构化错误（委托 shared 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（ENOENT/EBUSY…），无则空串（委托 shared） */
export const errnoCode = sharedErrnoCode
