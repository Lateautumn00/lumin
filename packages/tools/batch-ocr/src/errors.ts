/**
 * @file batch-ocr 工具错误码（UPPER_SNAKE；文案见 docs/spec/batch-ocr.md §6）
 * @author cuilanchao
 * @date 2026-11-20
 * @description renderer 与 main 共用；本模块只依赖 @lumin/shared，不得引入 node-kit。
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

export const BATCH_OCR_ERROR_CODES = [
  'BO_INVALID_PAYLOAD',
  'BO_FILE_NOT_FOUND',
  'BO_FILE_LOCKED',
  'BO_IMAGE_TOO_LARGE',
  'BO_INPUT_INVALID',
  'BO_NO_TEXT',
  'BO_TOO_MANY_FILES',
  'MODEL_MISSING',
  'BO_OCR_FAILED',
  'OP_TIMEOUT',
  'OUTPUT_WRITE_FAILED',
  'CANCELLED'
] as const

export type BatchOcrErrorCode = (typeof BATCH_OCR_ERROR_CODES)[number]

const MESSAGES: Record<BatchOcrErrorCode, string> = {
  BO_INVALID_PAYLOAD: '参数无效',
  BO_FILE_NOT_FOUND: '图片不存在，请重新选择',
  BO_FILE_LOCKED: '图片被其他程序占用，请关闭后重试',
  BO_IMAGE_TOO_LARGE: '图片超过 20MB，请压缩后重试',
  BO_INPUT_INVALID: '图片无法读取，请换一张清晰的图片',
  BO_NO_TEXT: '未识别到文字，请换更清晰的图片',
  BO_TOO_MANY_FILES: '单次最多 50 张图片',
  MODEL_MISSING: '识别模型缺失，请重新安装应用后重试',
  BO_OCR_FAILED: '识别失败，请重试或查看详情',
  OP_TIMEOUT: '处理超时（10 分钟），已终止',
  OUTPUT_WRITE_FAILED: '无法写出 TXT，请检查目录权限与剩余空间',
  CANCELLED: '已取消'
}

/** 可重试错误码（renderer 据此显示「重试」） */
const RETRYABLE = new Set<BatchOcrErrorCode>([
  'BO_FILE_LOCKED',
  'BO_NO_TEXT',
  'MODEL_MISSING',
  'BO_OCR_FAILED',
  'OP_TIMEOUT',
  'OUTPUT_WRITE_FAILED'
])

export function toolError(code: BatchOcrErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as BatchOcrErrorCode)
}

/** 判断抛出物是否已是结构化错误（委托 shared 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（ENOENT/EBUSY…），无则空串（委托 shared） */
export const errnoCode = sharedErrnoCode
