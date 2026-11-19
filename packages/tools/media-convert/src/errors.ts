/**
 * @file 工具错误码（UPPER_SNAKE；文案见 spec/media-convert.md §7，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-19
 * @description media-convert 专属结构化错误：构造、重试判定与共享工具委托
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** media-convert 错误码全集（spec §7） */
export const MEDIA_CONVERT_ERROR_CODES = [
  'MC_ENGINE_MISSING',
  'MC_FILE_UNSUPPORTED',
  'MC_FILE_CORRUPT',
  'MC_PROBE_FAILED',
  'MC_NO_STREAM',
  'MC_PARAM_INVALID',
  'MC_OUTPUT_WRITE_FAILED',
  'MC_TIMEOUT',
  'MC_NO_FILES',
  'MC_CANCELLED'
] as const

export type MediaConvertErrorCode = (typeof MEDIA_CONVERT_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §7 同源） */
const MESSAGES: Record<MediaConvertErrorCode, string> = {
  MC_ENGINE_MISSING: '处理引擎未就绪，请运行 fetch 脚本获取 ffmpeg',
  MC_FILE_UNSUPPORTED: '不支持该文件（仅支持常见音视频格式，单文件 ≤ 4GB）',
  MC_FILE_CORRUPT: '文件无法解析，可能已损坏或加密',
  MC_PROBE_FAILED: '无法读取音视频信息',
  MC_NO_STREAM: '文件缺少所需的音视频轨道',
  MC_PARAM_INVALID: '参数不正确，请检查后重试',
  MC_OUTPUT_WRITE_FAILED: '输出目录不可写或磁盘空间不足',
  MC_TIMEOUT: '处理超时（已输出文件保留）',
  MC_NO_FILES: '请先添加音视频文件',
  MC_CANCELLED: '已取消（已完成文件保留）'
}

/** 可重试错误码（renderer 据此显示 [重试]） */
const RETRYABLE = new Set<MediaConvertErrorCode>([
  'MC_FILE_CORRUPT',
  'MC_PROBE_FAILED',
  'MC_OUTPUT_WRITE_FAILED',
  'MC_TIMEOUT'
])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（stderr 尾行等）
 */
export function toolError(code: MediaConvertErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 错误码 → 中文文案（未知码回退通用文案）
 * @param code 结构化错误码字符串
 */
export function errorMessage(code: string): string {
  return (MESSAGES as Record<string, string>)[code] ?? '处理失败，请重试'
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as MediaConvertErrorCode)
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 ENOSPC），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode
