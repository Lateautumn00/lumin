/**
 * @file 工具错误码（UPPER_SNAKE；文案见 spec/file-hasher.md §7，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-19
 * @description file-hasher 专属结构化错误：构造、重试判定与共享工具委托
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** file-hasher 错误码全集（spec §7）；取消由壳统一 `CANCELLED`，不单列 */
export const FILE_HASHER_ERROR_CODES = [
  'FH_FILE_INVALID',
  'FH_HASH_FAILED',
  'FH_INVALID_PAYLOAD'
] as const

export type FileHasherErrorCode = (typeof FILE_HASHER_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §7 同源） */
const MESSAGES: Record<FileHasherErrorCode, string> = {
  FH_FILE_INVALID: '无法读取文件（不存在、非普通文件、超过 20 GB 或无权限）',
  FH_HASH_FAILED: '计算失败，文件可能被占用或读取中断',
  FH_INVALID_PAYLOAD: '参数无效'
}

/** 可重试错误码（renderer 据此显示 [重试失败项]） */
const RETRYABLE = new Set<FileHasherErrorCode>(['FH_FILE_INVALID', 'FH_HASH_FAILED'])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（errno 等）
 */
export function toolError(code: FileHasherErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as FileHasherErrorCode)
}

/** 取错误中文文案（未知码回退通用文案） */
export function errorMessage(code: string): string {
  return MESSAGES[code as FileHasherErrorCode] ?? '操作失败'
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 EACCES），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode
