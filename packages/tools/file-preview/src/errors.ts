/**
 * @file 工具错误码与中文文案（UPPER_SNAKE；spec §4 同源）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 纯函数返回结构化错误（code + 中文文案），UI 按 code 展示；主进程复用同一张表。
 */
import type { StructuredError } from '@lumin/shared'

/** file-preview 错误码全集（spec §4） */
export const FILE_PREVIEW_ERROR_CODES = [
  'FP_UNSUPPORTED',
  'FP_NOT_FOUND',
  'FP_LOCKED',
  'FP_TOO_LARGE',
  'FP_READ_FAILED',
  'FP_TEXT_DECODE_FAILED',
  'FP_PARSE_FAILED',
  'FP_PDF_PASSWORD',
  'FP_PDF_RENDER_FAILED',
  'FP_SOFFICE_MISSING',
  'FP_CONVERT_FAILED',
  'FP_CONVERT_TIMEOUT',
  'FP_INVALID_PATH'
] as const

export type FilePreviewErrorCode = (typeof FILE_PREVIEW_ERROR_CODES)[number]

/** 错误码 → 中文文案（spec §4 同源） */
const MESSAGES: Record<FilePreviewErrorCode, string> = {
  FP_UNSUPPORTED: '不支持预览该文件类型',
  FP_NOT_FOUND: '文件不存在或无法访问',
  FP_LOCKED: '文件被其他程序占用，请关闭后重试',
  FP_TOO_LARGE: '文件过大，无法预览',
  FP_READ_FAILED: '读取文件失败',
  FP_TEXT_DECODE_FAILED: '文本解码失败，编码可能不受支持',
  FP_PARSE_FAILED: '内容解析失败，请检查文件格式',
  FP_PDF_PASSWORD: 'PDF 已加密，暂不支持预览',
  FP_PDF_RENDER_FAILED: 'PDF 页面渲染失败',
  FP_SOFFICE_MISSING: '未找到 LibreOffice，请安装或指定 soffice 路径',
  FP_CONVERT_FAILED: 'Office 转换为 PDF 失败',
  FP_CONVERT_TIMEOUT: 'Office 转换超时（60 秒）',
  FP_INVALID_PATH: '文件路径无效'
}

/** 可重试错误码（UI 据此显示 [重试]） */
const RETRYABLE = new Set<FilePreviewErrorCode>([
  'FP_READ_FAILED',
  'FP_PDF_RENDER_FAILED',
  'FP_CONVERT_FAILED',
  'FP_CONVERT_TIMEOUT'
])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（errno / stderr 尾行等）
 */
export function toolError(code: FilePreviewErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === ''
    ? { code, message }
    : { code, message, detail }
}

/**
 * 错误码 → 中文文案（未知码回退原码，避免空白提示）
 * @param code 结构化错误码字符串
 */
export function errorMessage(code: string): string {
  return (MESSAGES as Record<string, string>)[code] ?? code
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as FilePreviewErrorCode)
}
