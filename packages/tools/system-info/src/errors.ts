/**
 * @file 工具错误码（UPPER_SNAKE；文案见 docs/spec/system-info.md §5，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-22
 * @description system-info 专属结构化错误：构造、重试判定与共享工具委托
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** 错误码全集（spec §5） */
export const SYSTEM_INFO_ERROR_CODES = [
  'SI_COLLECT_FAILED',
  'SI_CLIPBOARD_FAILED'
] as const

export type SystemInfoErrorCode = (typeof SYSTEM_INFO_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §5 同源） */
const MESSAGES: Record<SystemInfoErrorCode, string> = {
  SI_COLLECT_FAILED: '采集系统信息失败',
  SI_CLIPBOARD_FAILED: '复制失败（剪贴板不可用）'
}

/** 可重试错误码（renderer 据此显示 [重试]） */
const RETRYABLE = new Set<SystemInfoErrorCode>(['SI_COLLECT_FAILED'])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（errno 等）
 */
export function toolError(code: SystemInfoErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as SystemInfoErrorCode)
}

/** 取错误中文文案（未知码回退通用文案） */
export function errorMessage(code: string): string {
  return MESSAGES[code as SystemInfoErrorCode] ?? '操作失败'
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 EACCES），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode
