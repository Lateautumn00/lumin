/**
 * @file 工具错误码（UPPER_SNAKE；文案见 spec/folder-compare.md §6，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-20
 * @description folder-compare 专属结构化错误：构造、重试判定与共享工具委托
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** 错误码全集（spec §6）；取消由壳统一 `CANCELLED`，不单列 */
export const FOLDER_COMPARE_ERROR_CODES = [
  'FC_INVALID_PAYLOAD',
  'FC_ROOT_INVALID',
  'FC_TOO_MANY_FILES',
  'FC_COMPARE_FAILED'
] as const

export type FolderCompareErrorCode = (typeof FOLDER_COMPARE_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §6 同源） */
const MESSAGES: Record<FolderCompareErrorCode, string> = {
  FC_INVALID_PAYLOAD: '参数无效',
  FC_ROOT_INVALID: '无法读取对比目录（不存在、不是目录或无权限）',
  FC_TOO_MANY_FILES: '单侧文件超过 20 万个，请缩小对比范围',
  FC_COMPARE_FAILED: '对比失败（任务超时或异常中断）'
}

/** 可重试错误码（renderer 据此显示 [重试]） */
const RETRYABLE = new Set<FolderCompareErrorCode>(['FC_ROOT_INVALID', 'FC_COMPARE_FAILED'])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（侧别、errno 等）
 */
export function toolError(code: FolderCompareErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as FolderCompareErrorCode)
}

/** 取错误中文文案（未知码回退通用文案） */
export function errorMessage(code: string): string {
  return MESSAGES[code as FolderCompareErrorCode] ?? '操作失败'
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 EACCES），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode
