/**
 * @file 工具错误码（UPPER_SNAKE；文案见 spec/image-toolbox.md §7，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-18
 * @description image-toolbox 专属结构化错误：构造、重试判定与共享工具委托
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** image-toolbox 错误码全集（spec §7） */
export const IMAGE_TOOLBOX_ERROR_CODES = [
  'IT_ENGINE_MISSING',
  'IT_FILE_UNSUPPORTED',
  'IT_FILE_CORRUPT',
  'IT_OUTPUT_WRITE_FAILED',
  'IT_SCALE_INVALID',
  'IT_PROBE_FAILED',
  'IT_NO_FILES',
  'IT_FOLDER_EMPTY',
  'IT_GIF_TOO_LARGE',
  'IT_CANCELLED'
] as const

export type ImageToolboxErrorCode = (typeof IMAGE_TOOLBOX_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §7 同源） */
const MESSAGES: Record<ImageToolboxErrorCode, string> = {
  IT_ENGINE_MISSING: '处理引擎未就绪，请运行 fetch 脚本获取 ffmpeg',
  IT_FILE_UNSUPPORTED: '不支持该文件（仅支持常见图片格式，单文件 ≤ 200MB）',
  IT_FILE_CORRUPT: '文件无法解析，可能已损坏或加密',
  IT_OUTPUT_WRITE_FAILED: '输出目录不可写或磁盘空间不足',
  IT_SCALE_INVALID: '缩放参数不正确，请检查后重试',
  IT_PROBE_FAILED: '无法读取图片信息',
  IT_NO_FILES: '请先添加图片文件',
  IT_FOLDER_EMPTY: '文件夹不可读或未找到支持的图片',
  IT_GIF_TOO_LARGE: 'GIF 尺寸超出上限，请减小宽度或图片数量',
  IT_CANCELLED: '已取消（已完成的文件保留）'
}

/** 可重试错误码（renderer 据此显示 [重试]） */
const RETRYABLE = new Set<ImageToolboxErrorCode>([
  'IT_FILE_CORRUPT',
  'IT_OUTPUT_WRITE_FAILED',
  'IT_PROBE_FAILED'
])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（stderr 尾行等）
 */
export function toolError(code: ImageToolboxErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as ImageToolboxErrorCode)
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 ENOSPC），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode
