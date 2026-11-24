/**
 * @file 思维导图结构化错误码与中文文案
 * @author cuilanchao
 * @date 2026-11-24
 * @description 纯函数返回结构化错误（code + 中文文案），主进程与渲染进程共用；码表见 spec §8。
 */
import type { StructuredError } from '@lumin/shared'

/** 思维导图错误码全集（spec §8） */
export const MINDMAP_ERROR_CODES = [
  'MM_INVALID_PAYLOAD',
  'MM_INVALID_PATH',
  'MM_NOT_FOUND',
  'MM_LOCKED',
  'MM_DOC_TOO_LARGE',
  'MM_INVALID_DOCUMENT',
  'MM_NODE_LIMIT',
  'MM_IMPORT_INVALID',
  'MM_FILE_CHANGED',
  'MM_SAVE_FAILED',
  'MM_READ_FAILED',
  'MM_DRAFT_TOO_LARGE',
  'MM_EXPORT_TOO_LARGE',
  'MM_EXPORT_FAILED'
] as const

export type MindmapErrorCode = (typeof MINDMAP_ERROR_CODES)[number]

/** 错误码 → 中文文案（spec §8 同源） */
const MESSAGES: Record<MindmapErrorCode, string> = {
  MM_INVALID_PAYLOAD: '参数无效',
  MM_INVALID_PATH: '文件路径无效',
  MM_NOT_FOUND: '文件不存在',
  MM_LOCKED: '文件被其他程序占用，请关闭后重试',
  MM_DOC_TOO_LARGE: '文档超过 5MB 上限',
  MM_INVALID_DOCUMENT: '文档格式不正确，无法作为思维导图打开',
  MM_NODE_LIMIT: '节点超过 5000 个或层级超过 50 层',
  MM_IMPORT_INVALID: '导入内容无法解析为大纲',
  MM_FILE_CHANGED: '文件已被外部修改，请确认后覆盖或另存',
  MM_SAVE_FAILED: '保存失败，请检查磁盘空间与目录权限',
  MM_READ_FAILED: '读取失败，请检查文件权限',
  MM_DRAFT_TOO_LARGE: '草稿超过 2MB，已暂停自动保存',
  MM_EXPORT_TOO_LARGE: '导出图片尺寸过大（单边 8192px / 32M 像素）',
  MM_EXPORT_FAILED: '导出失败，请重试'
}

/** 可重试错误码（UI 据此显示「重试」） */
const RETRYABLE = new Set<MindmapErrorCode>([
  'MM_LOCKED',
  'MM_FILE_CHANGED',
  'MM_SAVE_FAILED',
  'MM_READ_FAILED',
  'MM_EXPORT_FAILED'
])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（errno / 尺寸 / 文件名等）
 */
export function toolError(code: MindmapErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
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
  return RETRYABLE.has(code as MindmapErrorCode)
}
