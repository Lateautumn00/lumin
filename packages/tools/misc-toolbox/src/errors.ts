/**
 * @file 工具错误码与统一结果形状（UPPER_SNAKE；文案见 spec/misc-toolbox.md §1，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 纯 renderer 工具也走统一结构化错误形状，便于 UI 按 code → 中文文案展示
 */
import type { StructuredError } from '@lumin/shared'

/** misc-toolbox 错误码全集（spec §1） */
export const MISC_TOOLBOX_ERROR_CODES = ['MT_CIDR_INVALID'] as const

export type MiscToolboxErrorCode = (typeof MISC_TOOLBOX_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §1 同源） */
const MESSAGES: Record<MiscToolboxErrorCode, string> = {
  MT_CIDR_INVALID: '子网 / IP 输入无效'
}

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（哪一段越界、前缀越界、IPv6 等）
 */
export function toolError(code: MiscToolboxErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 错误码 → 中文文案（未知码回退原码，避免空白提示）
 * @param code 结构化错误码字符串
 */
export function errorMessage(code: string): string {
  return MESSAGES[code as MiscToolboxErrorCode] ?? code
}
