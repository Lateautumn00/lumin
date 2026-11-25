/**
 * @file 工具错误码与中文文案（spec §5 同源）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 纯函数返回结构化错误（code + 中文文案），UI 按 code 展示；主进程复用同一张表。
 */
import type { StructuredError } from '@lumin/shared'

/** 播放页签错误码全集（spec §5） */
export const VIDEO_PLAYER_ERROR_CODES = [
  'VP_UNSUPPORTED_FORMAT',
  'VP_NOT_FOUND',
  'VP_RESOLVE_FAILED',
  'VP_PLAYBACK_FAILED',
  'VP_CODEC_UNSUPPORTED',
  'VP_READ_FAILED'
] as const

export type VideoPlayerErrorCode = (typeof VIDEO_PLAYER_ERROR_CODES)[number]

/** 错误码 → 中文文案（spec §5 同源） */
const MESSAGES: Record<VideoPlayerErrorCode, string> = {
  VP_UNSUPPORTED_FORMAT: '不支持该视频格式，请先用「音视频处理」转换',
  VP_NOT_FOUND: '文件不存在或无法访问',
  VP_RESOLVE_FAILED: '无法解析视频文件',
  // 解码失败（MediaError 3）：损坏只是可能之一，也可能是编码变体不支持，不武断断言损坏
  VP_PLAYBACK_FAILED: '视频解码失败，文件可能已损坏或编码不受支持',
  VP_CODEC_UNSUPPORTED:
    '视频编码不受支持，浏览器无法解码（文件未必损坏），请先用「音视频处理」转换',
  VP_READ_FAILED: '视频文件读取失败，文件可能已被移动、占用或无读取权限'
}

/** 可重试错误码（UI 据此显示 [重试]） */
const RETRYABLE = new Set<VideoPlayerErrorCode>([
  'VP_RESOLVE_FAILED',
  'VP_PLAYBACK_FAILED',
  'VP_READ_FAILED'
])

/** MediaError code → 简写标签（detail 展示用） */
const MEDIA_ERR_LABEL: Readonly<Record<number, string>> = {
  2: 'NETWORK',
  3: 'DECODE',
  4: 'SRC_NOT_SUPPORTED'
}

/**
 * 传输层被拦截（如 Chromium URL safety check 拒绝 file:// 媒体）也报 MediaError 4，
 * 但这不是编解码问题，不能提示「编码不受支持」。
 */
const LOAD_BLOCKED_PATTERN = /url safety check|media load rejected/i

/**
 * `<video>` 的 MediaError → 结构化错误（spec §6：code 分支映射）
 *
 * 修复误报「损坏」：MediaError 4（SRC_NOT_SUPPORTED）是容器合法但编码不受支持
 * （如 HEVC in mp4），与文件损坏是两回事，单独映射为 VP_CODEC_UNSUPPORTED；
 * 若原始文案表明是 URL 安全校验拦截，则归入读取失败（可重试）。
 *
 * @param code `video.error?.code`（1 ABORTED / 2 NETWORK / 3 DECODE / 4 SRC_NOT_SUPPORTED）
 * @param raw 浏览器 `MediaError.message` 原始文案（可空）
 * @returns 结构化错误；ABORTED（切换 src 的正常中断）返回 null 表示不提示
 */
export function playbackError(code: number | undefined, raw?: string): StructuredError | null {
  if (code === 1) return null
  const label = code === undefined ? undefined : MEDIA_ERR_LABEL[code]
  const head =
    code === undefined
      ? 'MediaError 未知'
      : `MediaError ${code}${label === undefined ? '' : `（${label}）`}`
  const detail = raw === undefined || raw === '' ? head : `${head}：${raw}`
  if (code === 2) return toolError('VP_READ_FAILED', detail)
  if (code === 4 && raw !== undefined && LOAD_BLOCKED_PATTERN.test(raw)) {
    return toolError('VP_READ_FAILED', detail)
  }
  if (code === 4) return toolError('VP_CODEC_UNSUPPORTED', detail)
  return toolError('VP_PLAYBACK_FAILED', detail)
}

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（errno / MediaError code 等）
 */
export function toolError(code: VideoPlayerErrorCode, detail?: string): StructuredError {
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
  return RETRYABLE.has(code as VideoPlayerErrorCode)
}
