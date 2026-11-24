/**
 * @file 工具错误码与统一结果形状（UPPER_SNAKE；文案见 spec/text-toolbox.md §5 与 §7.1，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-23
 * @description 纯 renderer 工具也走统一结构化错误形状，便于 UI 按 code → 中文文案展示
 */
import type { StructuredError } from '@lumin/shared'

/** 单次处理文本的字节上限（5MB，防渲染进程卡死） */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024

/** text-toolbox 错误码全集（spec §5 与 §7.1） */
export const TEXT_TOOLBOX_ERROR_CODES = [
  'TT_JSON_INVALID',
  'TT_TEXT_TOO_LARGE',
  'TT_BASE64_INVALID',
  'TT_URL_INVALID',
  'TT_REGEX_INVALID',
  'TT_HEX_INVALID',
  'TT_UNICODE_INVALID',
  'TT_REPLACE_INVALID',
  'TT_MORSE_INVALID',
  'TT_CSV_INVALID',
  'TT_INVALID_INPUT'
] as const

export type TextToolboxErrorCode = (typeof TEXT_TOOLBOX_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §5 与 §7.1 同源） */
const MESSAGES: Record<TextToolboxErrorCode, string> = {
  TT_JSON_INVALID: 'JSON 格式不正确',
  TT_TEXT_TOO_LARGE: '文本超过 5MB 上限，请分段处理',
  TT_BASE64_INVALID: '不是有效的 Base64 文本',
  TT_URL_INVALID: '不是有效的 URL 编码文本',
  TT_REGEX_INVALID: '正则表达式不正确',
  TT_HEX_INVALID: '不是有效的十六进制文本',
  TT_UNICODE_INVALID: '不是有效的 Unicode 转义文本',
  TT_REPLACE_INVALID: '查找内容不能为空',
  TT_MORSE_INVALID: '不是有效的摩尔斯电码文本',
  TT_CSV_INVALID: 'CSV/JSON 数据格式不正确',
  TT_INVALID_INPUT: '输入格式不正确，请检查后重试'
}

/** 纯函数统一结果：成功带值，失败带结构化错误（不含 throw） */
export type TextResult<T> = { ok: true; value: T } | { ok: false; error: StructuredError }

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（原生错误消息等）
 */
export function toolError(code: TextToolboxErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 错误码 → 中文文案（未知码回退原码，避免空白提示）
 * @param code 结构化错误码字符串
 */
export function errorMessage(code: string): string {
  return MESSAGES[code as TextToolboxErrorCode] ?? code
}

/**
 * 校验文本字节数上限（UTF-8）
 * @param text 待处理文本
 * @returns 超限时返回结构化错误，否则 null
 */
export function checkTextSize(text: string): StructuredError | null {
  const bytes = new TextEncoder().encode(text).length
  if (bytes <= MAX_TEXT_BYTES) return null
  return toolError('TT_TEXT_TOO_LARGE', `当前 ${bytes} 字节，上限 ${MAX_TEXT_BYTES} 字节`)
}
