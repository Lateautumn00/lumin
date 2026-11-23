/**
 * @file 工具错误码与中文文案（spec §4 同源）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 纯函数返回结构化错误（code + 中文文案），UI 按 code 展示；主进程复用同一张表。
 */
import type { StructuredError } from '@lumin/shared'

/** video-player 错误码全集（spec §4） */
export const VIDEO_PLAYER_ERROR_CODES = [
  'VP_UNSUPPORTED_FORMAT',
  'VP_NOT_FOUND',
  'VP_RESOLVE_FAILED',
  'VP_PLAYBACK_FAILED'
] as const

export type VideoPlayerErrorCode = (typeof VIDEO_PLAYER_ERROR_CODES)[number]

/** 错误码 → 中文文案（spec §4 同源） */
const MESSAGES: Record<VideoPlayerErrorCode, string> = {
  VP_UNSUPPORTED_FORMAT: '不支持该视频格式，请先用「音视频处理」转换',
  VP_NOT_FOUND: '文件不存在或无法访问',
  VP_RESOLVE_FAILED: '无法解析视频文件',
  VP_PLAYBACK_FAILED: '视频解码或播放失败，文件可能已损坏'
}

/** 可重试错误码（UI 据此显示 [重试]） */
const RETRYABLE = new Set<VideoPlayerErrorCode>(['VP_RESOLVE_FAILED', 'VP_PLAYBACK_FAILED'])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（errno / MediaError code 等）
 */
export function toolError(code: VideoPlayerErrorCode, detail?: string): StructuredError {
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
  return RETRYABLE.has(code as VideoPlayerErrorCode)
}
