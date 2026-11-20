/**
 * @file 工具错误码（UPPER_SNAKE；文案见 spec/image-rotate.md §6，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-20
 * @description image-rotate 专属结构化错误：构造、重试判定与共享工具委托
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** image-rotate 错误码全集（spec §6） */
export const IMAGE_ROTATE_ERROR_CODES = [
  'IR_ENGINE_MISSING',
  'IR_FILE_UNSUPPORTED',
  'IR_FILE_CORRUPT',
  'IR_OUTPUT_WRITE_FAILED',
  'IR_CANCELLED'
] as const

export type ImageRotateErrorCode = (typeof IMAGE_ROTATE_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §6 同源） */
const MESSAGES: Record<ImageRotateErrorCode, string> = {
  IR_ENGINE_MISSING: '处理引擎未就绪，请运行 fetch 脚本获取 ffmpeg',
  IR_FILE_UNSUPPORTED: '不支持该文件（仅支持 PNG/JPG/WebP/BMP/TIFF，单文件 ≤ 200MB）',
  IR_FILE_CORRUPT: '文件无法解析，可能已损坏或加密',
  IR_OUTPUT_WRITE_FAILED: '输出目录不可写或磁盘空间不足',
  IR_CANCELLED: '已取消（已完成的文件保留）'
}

/** 可重试错误码（renderer 据此保留文件列表以便重试） */
const RETRYABLE = new Set<ImageRotateErrorCode>(['IR_FILE_CORRUPT', 'IR_OUTPUT_WRITE_FAILED'])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（stderr 尾行等）
 */
export function toolError(code: ImageRotateErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as ImageRotateErrorCode)
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 ENOSPC），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode
