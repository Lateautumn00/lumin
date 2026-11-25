/**
 * @file 工具错误码与统一结果形状（UPPER_SNAKE；文案见 spec/markdown-tool.md §4，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 纯函数返回结构化错误（code + 中文文案），UI 按 code 展示；主进程复用同一张表
 */
import type { StructuredError } from '@lumin/shared'

/** markdown-tool 错误码全集（spec §4） */
export const MARKDOWN_TOOL_ERROR_CODES = [
  'MD_INPUT_TOO_LONG',
  'MD_JSON_INVALID',
  'MD_TS_NAME_INVALID',
  'MD_YAML_INVALID',
  'MD_CLIPBOARD_FAILED',
  'MD_SAVE_FAILED',
  'MD_NOT_FOUND',
  'MD_LOCKED',
  'MD_FILE_TOO_LARGE',
  'MD_READ_FAILED',
  'MD_FILE_CHANGED',
  'MD_EDITOR_FAILED'
] as const

export type MarkdownToolErrorCode = (typeof MARKDOWN_TOOL_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §4 同源） */
const MESSAGES: Record<MarkdownToolErrorCode, string> = {
  MD_INPUT_TOO_LONG: '输入内容过长（上限 200 万字符）',
  MD_JSON_INVALID: 'JSON 格式不合法，请检查语法',
  MD_TS_NAME_INVALID: '根类型名不合法，需为合法 TypeScript 标识符',
  MD_YAML_INVALID: 'YAML 格式不合法，请检查语法',
  MD_CLIPBOARD_FAILED: '复制失败，请手动选择文本复制',
  MD_SAVE_FAILED: '导出失败，请检查输出目录',
  MD_NOT_FOUND: '文件不存在或已被移动',
  MD_LOCKED: '文件被占用或没有访问权限',
  MD_FILE_TOO_LARGE: '文件过大（上限 5 MiB）',
  MD_READ_FAILED: '读取文件失败，请确认文件可正常访问',
  MD_FILE_CHANGED: '文件已被其他程序修改，请确认是否覆盖',
  MD_EDITOR_FAILED: '编辑器加载失败，请重新打开页面'
}

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（解析位置等）
 */
export function toolError(
  code: MarkdownToolErrorCode,
  detail?: string
): StructuredError & { code: MarkdownToolErrorCode } {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 错误码 → 中文文案（未知码回退原码，避免空白提示）
 * @param code 结构化错误码字符串
 */
export function errorMessage(code: string): string {
  return MESSAGES[code as MarkdownToolErrorCode] ?? code
}

/** 纯函数统一失败形状（code 供 UI 展示，message 为中文文案） */
export interface ToolFailure {
  ok: false
  code: MarkdownToolErrorCode
  message: string
  detail?: string
}

/**
 * 构造纯函数失败结果
 * @param code 工具错误码
 * @param detail 可选细节
 */
export function failure(code: MarkdownToolErrorCode, detail?: string): ToolFailure {
  const base: ToolFailure = { ok: false, code, message: MESSAGES[code] }
  return detail === undefined || detail === '' ? base : { ...base, detail }
}

/**
 * 文件系统异常 → errno 码或消息（用于 save 失败 detail）
 * @param err 捕获的异常
 */
export function errnoCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return err instanceof Error ? err.message : 'UNKNOWN'
}
