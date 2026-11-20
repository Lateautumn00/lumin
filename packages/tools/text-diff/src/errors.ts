/**
 * @file 工具错误码与统一结果形状（UPPER_SNAKE；文案见 spec/text-diff.md §4，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 纯 renderer 工具也走统一结构化错误形状，便于 UI 按 code → 中文文案展示
 */
import type { StructuredError } from '@lumin/shared'

/** text-diff 错误码全集（spec §4） */
export const TEXT_DIFF_ERROR_CODES = ['TD_TOO_LARGE', 'TD_CLIPBOARD_FAILED'] as const

export type TextDiffErrorCode = (typeof TEXT_DIFF_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §4 同源） */
const MESSAGES: Record<TextDiffErrorCode, string> = {
  TD_TOO_LARGE: '文本过大，单侧最多 20,000 行或 1,000,000 字符',
  TD_CLIPBOARD_FAILED: '复制失败，请手动选择文本复制'
}

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节
 */
export function toolError(code: TextDiffErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 错误码 → 中文文案（未知码回退原码，避免空白提示）
 * @param code 结构化错误码字符串
 */
export function errorMessage(code: string): string {
  return MESSAGES[code as TextDiffErrorCode] ?? code
}
