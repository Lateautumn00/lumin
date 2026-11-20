/**
 * @file 工具错误码（UPPER_SNAKE；文案见 spec/zip-tool.md §6，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-20
 * @description zip-tool 专属结构化错误：构造、重试判定与共享工具委托
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** 错误码全集（spec §6）；取消由壳统一 `CANCELLED`，不单列 */
export const ZIP_TOOL_ERROR_CODES = [
  'ZP_INVALID_PAYLOAD',
  'ZP_SOURCE_INVALID',
  'ZP_ARCHIVE_INVALID',
  'ZP_TARGET_INVALID',
  'ZP_TOO_MANY_ENTRIES',
  'ZP_ARCHIVE_TOO_LARGE',
  'ZP_TASK_FAILED'
] as const

export type ZipToolErrorCode = (typeof ZIP_TOOL_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §6 同源） */
const MESSAGES: Record<ZipToolErrorCode, string> = {
  ZP_INVALID_PAYLOAD: '参数无效',
  ZP_SOURCE_INVALID: '无法读取源文件或文件夹（不存在或无权限）',
  ZP_ARCHIVE_INVALID: '压缩包无法读取或已损坏',
  ZP_TARGET_INVALID: '无法写入目标位置（不存在、无权限或磁盘空间不足）',
  ZP_TOO_MANY_ENTRIES: '条目数超过 10 万个上限，请拆分后再试',
  ZP_ARCHIVE_TOO_LARGE: '解压后总大小超过 10GB 上限（疑似压缩炸弹）',
  ZP_TASK_FAILED: '任务失败（超时或异常中断）'
}

/** 可重试错误码（renderer 据此显示 [重试]） */
const RETRYABLE = new Set<ZipToolErrorCode>([
  'ZP_SOURCE_INVALID',
  'ZP_ARCHIVE_INVALID',
  'ZP_TARGET_INVALID',
  'ZP_TASK_FAILED'
])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（条目名、errno 等）
 */
export function toolError(code: ZipToolErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as ZipToolErrorCode)
}

/** 取错误中文文案（未知码回退通用文案） */
export function errorMessage(code: string): string {
  return MESSAGES[code as ZipToolErrorCode] ?? '操作失败'
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 EACCES），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode
