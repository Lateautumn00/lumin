import type { StructuredError } from '@lumin/shared'

/** 工具错误码（UPPER_SNAKE；文案见 spec §5，改动须同步 spec） */
export const EXAM_SPLIT_ERROR_CODES = [
  'PDF_NOT_FOUND',
  'PDF_LOCKED',
  'PDF_ENCRYPTED',
  'PDF_INVALID',
  'RANGE_INVALID',
  'NO_PAGES_LEFT',
  'OP_TIMEOUT',
  'OUTPUT_WRITE_FAILED',
  'OP_FAILED',
  'CANCELLED',
  'INVALID_PAYLOAD',
  'OCR_INPUT_INVALID',
  'MODEL_MISSING',
  'NO_REGIONS',
  'OCR_FAILED',
  'PAGE_NOT_SPREAD'
] as const

export type ExamSplitErrorCode = (typeof EXAM_SPLIT_ERROR_CODES)[number]

const MESSAGES: Record<ExamSplitErrorCode, string> = {
  PDF_NOT_FOUND: '输入文件不存在，请重新选择',
  PDF_LOCKED: '文件被其他程序占用，请关闭后重试',
  PDF_ENCRYPTED: 'PDF 已加密，请先解除密码再操作',
  PDF_INVALID: '文件无法读取（可能已损坏或非 PDF 文件）',
  RANGE_INVALID: '页码区间无效，请检查（如 1-3,5）',
  NO_PAGES_LEFT: '至少保留一页，已取消操作',
  OP_TIMEOUT: '处理超时（120 秒），已终止',
  OUTPUT_WRITE_FAILED: '无法写出结果文件，请检查目录权限与剩余空间',
  OP_FAILED: '处理失败，请重试或查看详情',
  CANCELLED: '已取消',
  INVALID_PAYLOAD: '参数无效',
  OCR_INPUT_INVALID: '图片无法读取，请换一张清晰的图片',
  MODEL_MISSING: '识别模型缺失，请在设置中下载后重试',
  NO_REGIONS: '未识别到题目区域，请检查图片清晰度',
  OCR_FAILED: '识别失败，请重试或查看详情',
  PAGE_NOT_SPREAD: '当前页面不是横向双页排版，无法对半切分'
}

/** 可重试错误码（renderer 据此显示 [重试]；spec §5） */
const RETRYABLE = new Set<ExamSplitErrorCode>([
  'PDF_LOCKED',
  'OP_TIMEOUT',
  'OUTPUT_WRITE_FAILED',
  'OP_FAILED',
  'MODEL_MISSING',
  'NO_REGIONS',
  'OCR_FAILED'
])

export function toolError(code: ExamSplitErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as ExamSplitErrorCode)
}
