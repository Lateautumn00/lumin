/**
 * @file 工具错误码与中文文案（UPPER_SNAKE；spec §5 同源）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 纯函数返回结构化错误（code + 中文文案），UI 按 code 展示；主进程复用同一张表。
 */
import type { StructuredError } from '@lumin/shared'

/** text-editor 错误码全集（spec §5） */
export const TEXT_EDITOR_ERROR_CODES = [
  'TE_NOT_FOUND',
  'TE_LOCKED',
  'TE_TOO_LARGE',
  'TE_DECODE_FAILED',
  'TE_SAVE_FAILED',
  'TE_FILE_CHANGED',
  'TE_FILE_EXISTS',
  'TE_INVALID_PATH'
] as const

export type TextEditorErrorCode = (typeof TEXT_EDITOR_ERROR_CODES)[number]

/** 错误码 → 中文文案（spec §5 同源） */
const MESSAGES: Record<TextEditorErrorCode, string> = {
  TE_NOT_FOUND: '文件不存在或无法访问',
  TE_LOCKED: '文件被其他程序占用，请关闭后重试',
  TE_TOO_LARGE: '文件超过 5 MiB，无法在编辑器中打开',
  TE_DECODE_FAILED: '文件不是可识别的文本，或编码不受支持',
  TE_SAVE_FAILED: '保存失败，请检查磁盘空间与目录权限',
  TE_FILE_CHANGED: '文件已被其他程序修改，请重新加载或覆盖保存',
  TE_FILE_EXISTS: '目标位置已存在同名文件',
  TE_INVALID_PATH: '文件路径无效'
}

/** 可重试错误码（UI 据此显示 [重试]） */
const RETRYABLE = new Set<TextEditorErrorCode>(['TE_LOCKED', 'TE_SAVE_FAILED'])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（字节数 / errno / 文件名等）
 */
export function toolError(code: TextEditorErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === ''
    ? { code, message }
    : { code, message, detail }
}

/**
 * 错误码 → 中文文案（未知码回退原码，避免空白提示）
 * @param code 结构化错误码字符串
 */
export function errorMessage(code: string): string {
  return (MESSAGES as Record<string, string>)[code] ?? code
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as TextEditorErrorCode)
}
