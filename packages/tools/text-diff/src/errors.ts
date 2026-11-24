/**
 * @file 工具错误码与统一结果形状（UPPER_SNAKE；文案见 spec/text-diff.md §5，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 结构化错误形状（M62 扩展文件比较三码 + 信封 INVALID_INPUT），
 *              便于 UI 按 code → 中文文案展示
 */
import type { StructuredError } from '@lumin/shared'

/** text-diff 错误码全集（spec §5） */
export const TEXT_DIFF_ERROR_CODES = [
  'TD_TOO_LARGE',
  'TD_CLIPBOARD_FAILED',
  'TD_FILE_READ_FAILED',
  'TD_FILE_TOO_LARGE',
  'TD_UNSUPPORTED_ENCODING',
  'INVALID_INPUT'
] as const

export type TextDiffErrorCode = (typeof TEXT_DIFF_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §5 同源） */
const MESSAGES: Record<TextDiffErrorCode, string> = {
  TD_TOO_LARGE: '文本过大，单侧最多 20,000 行或 1,000,000 字符',
  TD_CLIPBOARD_FAILED: '复制失败，请手动选择文本复制',
  TD_FILE_READ_FAILED: '文件读取失败，请检查路径是否存在及读取权限',
  TD_FILE_TOO_LARGE: '文件过大，单文件最大 200MB',
  TD_UNSUPPORTED_ENCODING: '不支持的文件编码，请另存为 UTF-8 后重试',
  INVALID_INPUT: '请求格式无效'
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
