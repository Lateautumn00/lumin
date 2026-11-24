/**
 * @file 结构化错误码（AGENTS §6：错误统一结构化错误码，中文文案）
 * @author cuilanchao
 * @date 2026-11-24
 * @description CH_STORAGE_FAILED（存储读写失败，可重试）、CH_IMAGE_MISSING（图片文件
 *              丢失，可重试）与 INVALID_INPUT（信封校验失败 / pin·remove·image·copy
 *              非法 id，文案沿用共享信封）。
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError
} from '@lumin/shared'

/** 工具错误码（code 必须大写蛇形，否则运行时抛错） */
export const CLIPBOARD_HISTORY_ERROR_CODES = [
  'CH_STORAGE_FAILED',
  'CH_IMAGE_MISSING',
  'INVALID_INPUT'
] as const
export type ClipboardHistoryErrorCode = (typeof CLIPBOARD_HISTORY_ERROR_CODES)[number]

/** 错误码 → 中文文案 */
const MESSAGES: Record<ClipboardHistoryErrorCode, string> = {
  CH_STORAGE_FAILED: '剪贴板历史读写失败',
  CH_IMAGE_MISSING: '图片文件已丢失',
  INVALID_INPUT: '请求格式无效'
}

export function toolError(code: ClipboardHistoryErrorCode, detail?: string): object {
  return detail == null || detail === ''
    ? { code, message: MESSAGES[code] }
    : { code, message: MESSAGES[code], detail }
}

/** 存储读写失败与图片文件丢失可重试（INVALID_INPUT 重试无意义） */
export function isRetryable(code: string): boolean {
  return code === 'CH_STORAGE_FAILED' || code === 'CH_IMAGE_MISSING'
}

/** 结构化错误判别（IPC bus 同一信封） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（detail 首选），无则回退 message */
export const errnoCode = sharedErrnoCode
