/**
 * @file errors.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description 文件打印工具结构化错误码与中文文案（spec §5，改动须同步 spec）。
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** 工具错误码（UPPER_SNAKE，前缀 PR_） */
export const PRINT_ERROR_CODES = [
  'PR_UNSUPPORTED_FORMAT',
  'PR_NOT_FOUND',
  'PR_LOCKED',
  'PR_TOO_LARGE',
  'PR_SOFFICE_MISSING',
  'PR_CONVERT_FAILED',
  'PR_CONVERT_TIMEOUT',
  'PR_PDF_PASSWORD',
  'PR_PDF_BROKEN',
  'PR_PRINT_FAILED',
  'PR_PRINT_CANCELLED',
  'PR_PRINT_BUSY',
  'PR_INVALID_PATH',
  'PR_TOO_MANY_FILES'
] as const

export type PrintErrorCode = (typeof PRINT_ERROR_CODES)[number]

const MESSAGES: Record<PrintErrorCode, string> = {
  PR_UNSUPPORTED_FORMAT: '不支持的文件类型',
  PR_NOT_FOUND: '文件不存在，请重新选择',
  PR_LOCKED: '文件被其他程序占用，请关闭后重试',
  PR_TOO_LARGE: '文件超过 500 MiB，无法打印',
  PR_SOFFICE_MISSING: '未检测到 LibreOffice 转换组件，无法打印 Office 文件',
  PR_CONVERT_FAILED: 'Office 转 PDF 失败',
  PR_CONVERT_TIMEOUT: 'Office 转 PDF 超时（60 秒），已终止',
  PR_PDF_PASSWORD: 'PDF 已加密，请先解除密码保护',
  PR_PDF_BROKEN: 'PDF 无法解析（可能已损坏）',
  PR_PRINT_FAILED: '打印失败，请重试或检查打印机',
  PR_PRINT_CANCELLED: '已取消打印',
  PR_PRINT_BUSY: '已有打印任务进行中，请等待完成',
  PR_INVALID_PATH: '文件路径无效',
  PR_TOO_MANY_FILES: '单次最多打印 50 个文件'
}

/** 可重试错误码（renderer 据此显示 [重试]；spec §5） */
const RETRYABLE = new Set<PrintErrorCode>([
  'PR_LOCKED',
  'PR_CONVERT_FAILED',
  'PR_CONVERT_TIMEOUT',
  'PR_PRINT_FAILED',
  'PR_PRINT_BUSY'
])

/** 构造工具结构化错误（可选 detail 供「详情」展示） */
export function toolError(code: PrintErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/** 错误码是否可重试 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as PrintErrorCode)
}

/** 判断抛出物是否已是结构化错误（委托 shared 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 ENOENT/EBUSY），无则空串 */
export const errnoCode = sharedErrnoCode
