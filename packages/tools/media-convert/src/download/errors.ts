/**
 * @file 工具错误码（UPPER_SNAKE；文案见 spec/media-convert-download.md §5，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 下载页签专属结构化错误：构造、重试判定与共享工具委托
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** 下载页签错误码全集（spec §5） */
export const VIDEO_DOWNLOAD_ERROR_CODES = [
  'VD_URL_INVALID',
  'VD_ENGINE_MISSING',
  'VD_PROBE_FAILED',
  'VD_UNSUPPORTED_PLATFORM',
  'VD_OUTPUT_WRITE_FAILED',
  'VD_DOWNLOAD_FAILED',
  'VD_HISTORY_FAILED',
  'VD_COOKIE_FORMAT_INVALID',
  'VD_COOKIE_IMPORT_FAILED',
  'VD_COOKIE_STORE_UNAVAILABLE',
  'VD_LINK_EXPIRED',
  'VD_LOGIN_REQUIRED',
  'VD_REGION_BLOCKED',
  'VD_FORBIDDEN'
] as const

export type VideoDownloadErrorCode = (typeof VIDEO_DOWNLOAD_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §5 同源） */
const MESSAGES: Record<VideoDownloadErrorCode, string> = {
  VD_URL_INVALID: '链接格式不正确，请检查后重试',
  VD_ENGINE_MISSING: '下载引擎未就绪，请运行 fetch 脚本获取 yt-dlp 后重试',
  VD_PROBE_FAILED: '无法获取视频信息，请确认链接可公开访问',
  VD_UNSUPPORTED_PLATFORM: '暂不支持该平台链接',
  VD_OUTPUT_WRITE_FAILED: '输出目录不可写或磁盘空间不足',
  VD_DOWNLOAD_FAILED: '下载失败，请查看详情或稍后重试',
  VD_HISTORY_FAILED: '历史记录读写失败',
  VD_COOKIE_FORMAT_INVALID: 'Cookie 格式无法识别，请粘贴浏览器导出的 Cookie',
  VD_COOKIE_IMPORT_FAILED: '从浏览器读取 Cookie 失败，请改用手动粘贴',
  VD_COOKIE_STORE_UNAVAILABLE: '系统不支持加密存储，Cookie 功能不可用',
  VD_LINK_EXPIRED: '链接已失效或内容不可访问，请重新复制分享链接后重试',
  VD_LOGIN_REQUIRED: '该内容需要登录后访问，请先在 Cookie 管理中配置对应平台后重试',
  VD_REGION_BLOCKED: '该内容在当前地区不可用',
  VD_FORBIDDEN: '平台拒绝访问（403），请稍后重试或更换链接'
}

/** 可重试错误码（renderer 据此显示 [重试]） */
const RETRYABLE = new Set<VideoDownloadErrorCode>([
  'VD_PROBE_FAILED',
  'VD_OUTPUT_WRITE_FAILED',
  'VD_DOWNLOAD_FAILED',
  'VD_HISTORY_FAILED'
])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（stderr 尾行等）
 */
export function toolError(code: VideoDownloadErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as VideoDownloadErrorCode)
}

/** 引擎 stderr 归因规则（顺序敏感：先具体后宽泛；spec §5.1） */
const ENGINE_PATTERNS: ReadonlyArray<readonly [RegExp, VideoDownloadErrorCode]> = [
  [/sign in to confirm|login required|please log in|需要登录|cookies?.*(required|expired)/i, 'VD_LOGIN_REQUIRED'],
  [/not available in your country|geo.?restrict|地区|region.?lock/i, 'VD_REGION_BLOCKED'],
  [/http error 403|403 forbidden|forbidden/i, 'VD_FORBIDDEN'],
  [/unsupported url|no suitable extractor/i, 'VD_UNSUPPORTED_PLATFORM'],
  [/private video|video unavailable|has been removed|does not exist/i, 'VD_LINK_EXPIRED']
]

/**
 * 将 yt-dlp stderr 归因为结构化错误码（无匹配返回 null，调用方回退通用码）
 * @param text 引擎输出（stdout+stderr 尾部）
 */
export function classifyEngineError(text: string): VideoDownloadErrorCode | null {
  for (const [pattern, code] of ENGINE_PATTERNS) {
    if (pattern.test(text)) return code
  }
  return null
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 ENOSPC），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode
