/**
 * @file 工具错误码（UPPER_SNAKE；文案见 docs/spec/image-toolbox.md §12.3，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-19
 * @description qr-code 专属结构化错误：构造、重试判定与共享工具委托
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** qr-code 错误码全集（spec §7） */
export const QR_CODE_ERROR_CODES = [
  'QR_INVALID_CONTENT',
  'QR_CONTENT_TOO_LONG',
  'QR_INVALID_PAYLOAD',
  'QR_OUTPUT_WRITE_FAILED',
  'QR_IMAGE_TOO_LARGE',
  'QR_IMAGE_UNREADABLE',
  'QR_DECODE_FAILED',
  'QR_NO_IMAGE'
] as const

export type QrCodeErrorCode = (typeof QR_CODE_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §7 同源） */
const MESSAGES: Record<QrCodeErrorCode, string> = {
  QR_INVALID_CONTENT: '内容为空或格式不正确',
  QR_CONTENT_TOO_LONG: '内容超出长度上限',
  QR_INVALID_PAYLOAD: '参数无效',
  QR_OUTPUT_WRITE_FAILED: '输出目录不可写或磁盘空间不足',
  QR_IMAGE_TOO_LARGE: '图片超过 20MB，请压缩后重试',
  QR_IMAGE_UNREADABLE: '图片无法读取，可能已损坏或格式不支持',
  QR_DECODE_FAILED: '未识别到二维码，请换更清晰、完整的图片',
  QR_NO_IMAGE: '请先选择一张包含二维码的图片'
}

/** 可重试错误码（renderer 据此显示 [重试]） */
const RETRYABLE = new Set<QrCodeErrorCode>(['QR_OUTPUT_WRITE_FAILED'])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（字段名、errno 等）
 */
export function toolError(code: QrCodeErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as QrCodeErrorCode)
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 ENOSPC），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode
