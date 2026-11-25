/**
 * @file 工具错误码（UPPER_SNAKE；文案见 spec/file-renamer.md §6，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-18
 * @description file-renamer 专属结构化错误：构造、重试判定与共享工具委托
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** file-renamer 错误码全集（spec §6） */
export const FILE_RENAMER_ERROR_CODES = [
  'FR_DIR_NOT_FOUND',
  'FR_NO_FILES',
  'FR_NAME_INVALID',
  'FR_NAME_RESERVED',
  'FR_CONFLICT',
  'FR_RENAME_FAILED',
  'FR_TOO_MANY',
  'FR_CANCELLED'
] as const

export type FileRenamerErrorCode = (typeof FILE_RENAMER_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §6 同源） */
const MESSAGES: Record<FileRenamerErrorCode, string> = {
  FR_DIR_NOT_FOUND: '目录不存在或无权访问',
  FR_NO_FILES: '目录内没有可重命名的文件',
  FR_NAME_INVALID: '文件名不合法（含保留字符、空白或超长）',
  FR_NAME_RESERVED: '使用了 Windows 保留名（CON/PRN/AUX/NUL/COM1–9/LPT1–9）',
  FR_CONFLICT: '目标名已存在或与其它文件重复',
  FR_RENAME_FAILED: '重命名失败，文件可能被占用或无权限',
  FR_TOO_MANY: '目录文件过多（上限 5000）',
  FR_CANCELLED: '已取消（已完成的重命名保留）'
}

/** 可重试错误码（renderer 据此显示 [重试]） */
const RETRYABLE = new Set<FileRenamerErrorCode>(['FR_DIR_NOT_FOUND', 'FR_RENAME_FAILED'])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（errno 等）
 */
export function toolError(code: FileRenamerErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as FileRenamerErrorCode)
}

/** 取错误中文文案（未知码回退通用文案） */
export function errorMessage(code: string): string {
  return MESSAGES[code as FileRenamerErrorCode] ?? '操作失败'
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 EACCES），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode
