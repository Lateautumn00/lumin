/**
 * @file 工具错误码（UPPER_SNAKE；文案见 spec/duplicate-finder.md §7，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-19
 * @description duplicate-finder 专属结构化错误：构造、重试判定与共享工具委托
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** 错误码全集（spec §7）；取消由壳统一 `CANCELLED`，不单列 */
export const DUPLICATE_FINDER_ERROR_CODES = [
  'DF_INVALID_PAYLOAD',
  'DF_ROOT_INVALID',
  'DF_TOO_MANY_FILES',
  'DF_SCAN_FAILED'
] as const

export type DuplicateFinderErrorCode = (typeof DUPLICATE_FINDER_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §7 同源） */
const MESSAGES: Record<DuplicateFinderErrorCode, string> = {
  DF_INVALID_PAYLOAD: '参数无效',
  DF_ROOT_INVALID: '无法读取扫描目录（不存在、不是目录或无权限）',
  DF_TOO_MANY_FILES: '目录文件超过 20 万个，请缩小范围或提高大小阈值',
  DF_SCAN_FAILED: '扫描失败（任务超时或异常中断）'
}

/** 可重试错误码（renderer 据此显示 [重试]） */
const RETRYABLE = new Set<DuplicateFinderErrorCode>(['DF_ROOT_INVALID', 'DF_SCAN_FAILED'])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（errno 等）
 */
export function toolError(code: DuplicateFinderErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as DuplicateFinderErrorCode)
}

/** 取错误中文文案（未知码回退通用文案） */
export function errorMessage(code: string): string {
  return MESSAGES[code as DuplicateFinderErrorCode] ?? '操作失败'
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 EACCES），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode
