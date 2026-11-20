/**
 * @file 工具错误码与统一结果形状（UPPER_SNAKE；文案见 spec/time-toolbox.md §4，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 纯 renderer 工具也走统一结构化错误形状，便于 UI 按 code → 中文文案展示
 */
import type { StructuredError } from '@lumin/shared'

/** time-toolbox 错误码全集（spec §4） */
export const TIME_TOOLBOX_ERROR_CODES = [
  'TT_INVALID_INPUT',
  'TT_OUT_OF_RANGE',
  'TT_CLIPBOARD_FAILED'
] as const

export type TimeToolboxErrorCode = (typeof TIME_TOOLBOX_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §4 同源） */
const MESSAGES: Record<TimeToolboxErrorCode, string> = {
  TT_INVALID_INPUT: '输入格式不正确，请检查后重试',
  TT_OUT_OF_RANGE: '数值超出可表示范围',
  TT_CLIPBOARD_FAILED: '复制失败，请手动选择文本复制'
}

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（字段位、非法时区名等）
 */
export function toolError(code: TimeToolboxErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 错误码 → 中文文案（未知码回退原码，避免空白提示）
 * @param code 结构化错误码字符串
 */
export function errorMessage(code: string): string {
  return MESSAGES[code as TimeToolboxErrorCode] ?? code
}
