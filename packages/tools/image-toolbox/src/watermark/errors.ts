/**
 * @file 工具错误码（UPPER_SNAKE；文案见 spec/image-watermark.md §6，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-20
 * @description image-watermark 专属结构化错误：构造、重试判定与共享工具委托
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** image-watermark 错误码全集（spec §6） */
export const IMAGE_WATERMARK_ERROR_CODES = [
  'IW_INVALID_PAYLOAD',
  'IW_INPUT_INVALID',
  'IW_FILE_LOCKED',
  'IW_IMAGE_TOO_LARGE',
  'IW_IMAGE_CORRUPT',
  'IW_WATERMARK_MISSING',
  'IW_WATERMARK_INVALID',
  'IW_OUTPUT_DIR_INVALID',
  'IW_WRITE_FAILED',
  'IW_PROCESS_FAILED',
  'OP_TIMEOUT',
  'CANCELLED'
] as const

export type ImageWatermarkErrorCode = (typeof IMAGE_WATERMARK_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §6 同源） */
const MESSAGES: Record<ImageWatermarkErrorCode, string> = {
  IW_INVALID_PAYLOAD: '参数无效',
  IW_INPUT_INVALID: '图片不存在或不受支持',
  IW_FILE_LOCKED: '图片被其他程序占用，请关闭后重试',
  IW_IMAGE_TOO_LARGE: '图片超过 40MB，请压缩后重试',
  IW_IMAGE_CORRUPT: '图片无法解码，可能已损坏',
  IW_WATERMARK_MISSING: '水印图片不存在，请重新选择',
  IW_WATERMARK_INVALID: '水印图片无效（需 PNG / JPG / WebP，≤5MB）',
  IW_OUTPUT_DIR_INVALID: '输出目录不可用或不可写',
  IW_WRITE_FAILED: '写入失败，请检查磁盘空间与目录权限',
  IW_PROCESS_FAILED: '处理失败，请重试或查看详情',
  OP_TIMEOUT: '处理超时（10 分钟），已终止',
  CANCELLED: '已取消'
}

/** 可重试错误码（renderer 据此显示 [重试]） */
const RETRYABLE = new Set<ImageWatermarkErrorCode>([
  'IW_FILE_LOCKED',
  'IW_IMAGE_CORRUPT',
  'IW_OUTPUT_DIR_INVALID',
  'IW_WRITE_FAILED',
  'IW_PROCESS_FAILED',
  'OP_TIMEOUT'
])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（errno / 解码消息尾行等）
 */
export function toolError(code: ImageWatermarkErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as ImageWatermarkErrorCode)
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 ENOSPC），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode
