/**
 * @file errors.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description pdf-toolkit 结构化错误（文案与可重试判定同源，spec §7）
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** 工具错误码全集（spec §7） */
export const PDF_TOOLKIT_ERROR_CODES = [
  'PT_INPUT_INVALID',
  'PT_PDF_LOCKED',
  'PT_PDF_ENCRYPTED',
  'PT_PDF_CORRUPT',
  'PT_RANGE_INVALID',
  'PT_NO_PAGES_LEFT',
  'PT_ORDER_INVALID',
  'PT_OUTPUT_WRITE_FAILED',
  'PT_TIMEOUT',
  'PT_OP_FAILED',
  'PT_WATERMARK_INVALID',
  'PT_PAGE_NUMBER_INVALID'
] as const

export type PdfToolkitErrorCode = (typeof PDF_TOOLKIT_ERROR_CODES)[number]

/** 错误码 → 中文文案（spec §7 同源） */
const MESSAGES: Record<PdfToolkitErrorCode, string> = {
  PT_INPUT_INVALID: '输入文件不存在或不是 PDF',
  PT_PDF_LOCKED: 'PDF 正被其他程序占用，请关闭后重试',
  PT_PDF_ENCRYPTED: 'PDF 已加密，请先解除密码保护',
  PT_PDF_CORRUPT: 'PDF 无法解析，可能已损坏',
  PT_RANGE_INVALID: '页码范围不正确，请检查（如 1-3,5）',
  PT_NO_PAGES_LEFT: '至少需要保留一页',
  PT_ORDER_INVALID: '页面顺序无效，必须包含全部页码各一次',
  PT_OUTPUT_WRITE_FAILED: '无法写出结果，请检查目录权限与剩余空间',
  PT_TIMEOUT: '处理超时（120 秒），已终止',
  PT_OP_FAILED: '处理失败，请重试或查看详情',
  PT_WATERMARK_INVALID: '水印内容无效，请检查文字或图片',
  PT_PAGE_NUMBER_INVALID: '页码参数无效，请检查格式、位置与起始页'
}

/** 可重试错误码（renderer 据此显示 [重试]） */
const RETRYABLE = new Set<PdfToolkitErrorCode>([
  'PT_PDF_LOCKED',
  'PT_PDF_CORRUPT',
  'PT_RANGE_INVALID',
  'PT_ORDER_INVALID',
  'PT_OUTPUT_WRITE_FAILED',
  'PT_TIMEOUT',
  'PT_OP_FAILED'
])

/**
 * 构造结构化错误
 * @param code 工具错误码
 * @param detail 可选技术细节（errno / pdf-lib 消息尾行等）
 */
export function toolError(code: PdfToolkitErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/** 判断错误码是否可重试 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as PdfToolkitErrorCode)
}

/** 是否已是结构化错误（委托 shared 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 ENOSPC），无则空串 */
export const errnoCode = sharedErrnoCode
