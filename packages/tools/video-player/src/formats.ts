/**
 * @file 视频格式白名单与 MIME（spec §2：仅浏览器原生格式）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 纯函数：扩展名归一、支持判定、文件选择器 accept 与 MIME 映射。
 */

/** 支持的扩展名（小写；仅 Chromium 原生可解格式） */
export const SUPPORTED_EXTENSIONS = ['mp4', 'webm', 'ogv', 'ogg'] as const

export type VideoExtension = (typeof SUPPORTED_EXTENSIONS)[number]

/** 文件选择器 accept 字符串 */
export const VIDEO_ACCEPT = SUPPORTED_EXTENSIONS.map((ext) => `.${ext}`).join(',')

/** 不支持格式提示（UI 错误态与主进程 detail 共用） */
export const UNSUPPORTED_HINT = '仅支持 MP4 / WebM / OGV / OGG，其他格式请先用「音视频处理」转换'

/** 扩展名 → MIME（<video> 元素按 src 后缀亦可推断，此处显式返回供展示） */
const MIME_BY_EXTENSION: Readonly<Record<VideoExtension, string>> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ogg: 'video/ogg'
}

/**
 * 取扩展名（小写、无点）；无扩展名/隐藏文件返回 null
 * @param path 文件路径（兼容 `\` 与 `/`）
 */
export function extensionOf(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  return name.slice(dot + 1).toLowerCase()
}

/**
 * 路径 → 支持的扩展名；不支持返回 null
 * @param path 文件路径
 */
export function videoExtensionOf(path: string): VideoExtension | null {
  const ext = extensionOf(path)
  if (ext === null) return null
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as VideoExtension)
    : null
}

/**
 * 是否支持该路径的视频
 * @param path 文件路径
 */
export function isSupportedVideo(path: string): boolean {
  return videoExtensionOf(path) !== null
}

/**
 * 扩展名 → MIME
 * @param ext 扩展名（可带点，任意大小写）
 */
export function mimeOf(ext: string): string | null {
  const key = ext.replace(/^\./, '').toLowerCase()
  return (MIME_BY_EXTENSION as Record<string, string>)[key] ?? null
}
