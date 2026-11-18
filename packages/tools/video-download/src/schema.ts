/**
 * @file IPC 入参/出参 schema（AGENTS §6：所有入参经 zod 校验后才进 handler；契约见 spec/video-download.md §4）
 * @author cuilanchao
 * @date 2026-11-18
 * @description probe/start/history/mark-pause 通道的 zod schema 与推导类型
 */
import { z } from 'zod'

/** http(s) 链接约束（spec §1：非 http(s) → VD_URL_INVALID） */
export const VIDEO_URL_RE = /^https?:\/\/\S+$/i

/**
 * URL 匹配字符集：http(s) 之后取 ASCII 可见字符，排除 CJK 与全角/中文标点区段——
 * 分享口令里 URL 与中文正文常无空格分隔，贪婪匹配会把正文吞进 URL。
 * （punycode/percent-encoding 的合法 URL 本身已是 ASCII，不受影响。）
 */
const URL_CHARS_RE = /https?:\/\/[^\s\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/i

/** URL 首尾可能被包裹的半角字符（反引号/引号/括号等） */
const WRAP_HEAD_RE = /^["'`([{《“「【]+/
const WRAP_TAIL_RE = /["'`)\]}》”」】、，。；！？:：!?;,.]+$/

/**
 * 从分享口令文本中提取第一个 http(s) URL（spec §1：抖音/快手等 App 复制的口令
 * 为「文案 + 短链 + 随机码」混合文本，URL 常被反引号/引号/书名号包裹或与中文紧邻）。
 * 未匹配到 URL 时原样返回，交由 VIDEO_URL_RE 校验报错。
 * @param raw 用户粘贴的原始文本
 * @returns 提取出的 URL；无 URL 时返回原始串
 */
export function extractVideoUrl(raw: string): string {
  const match = raw.match(URL_CHARS_RE)
  if (match === null) return raw
  return match[0].replace(WRAP_HEAD_RE, '').replace(WRAP_TAIL_RE, '')
}

/** url 字段：先做分享口令提取，再校验 http(s) 约束（probe/start 共用） */
const urlSchema = z.preprocess(
  (raw) => (typeof raw === 'string' ? extractVideoUrl(raw.trim()) : raw),
  z.string().min(1).regex(VIDEO_URL_RE, '仅支持 http(s) 链接')
)

/** 格式预设（spec §1）：best = 自动最优合流；1080p = 限高；audio-mp3 = 仅音频转 mp3 */
export const PRESET_VALUES = ['best', '1080p', 'audio-mp3'] as const
export const presetSchema = z.enum(PRESET_VALUES)
export type Preset = z.infer<typeof presetSchema>

/** `video-download:probe` 入参 */
export const probePayloadSchema = z.object({
  url: urlSchema
})
export type ProbePayload = z.infer<typeof probePayloadSchema>

/** probe 返回（yt-dlp -J JSON 的投影，字段缺失容忍） */
export const probeResultSchema = z.object({
  title: z.string().min(1),
  platform: z.string().optional(),
  durationSec: z.number().min(0).optional(),
  thumbnailUrl: z.string().optional()
})
export type ProbeResult = z.infer<typeof probeResultSchema>

/** `video-download:start` 入参（长任务提交；outputDir 缺省 = 主进程 userData/downloads） */
export const startPayloadSchema = z.object({
  url: urlSchema,
  preset: presetSchema,
  outputDir: z.string().min(1).optional()
})
export type StartPayload = z.infer<typeof startPayloadSchema>

/** 下载完成 done result */
export interface DownloadResult {
  outputPath: string
}

/** 历史条目（spec §6；存储于 settings `tools.video-download.history`） */
export const HISTORY_STATUSES = ['RUNNING', 'PAUSED', 'DONE', 'FAILED', 'CANCELLED'] as const

export const historyEntrySchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  title: z.string(),
  platform: z.string().optional(),
  preset: presetSchema,
  outputDir: z.string().min(1),
  outputName: z.string().optional(),
  status: z.enum(HISTORY_STATUSES),
  downloadedBytes: z.number().min(0).optional(),
  totalBytes: z.number().min(0).optional(),
  startedAt: z.number().min(0),
  endedAt: z.number().min(0).optional()
})
export type HistoryEntry = z.infer<typeof historyEntrySchema>

/** `video-download:history` 返回 */
export const historyResultSchema = z.object({
  entries: z.array(historyEntrySchema)
})
export type HistoryResult = z.infer<typeof historyResultSchema>

/** `video-download:history:clear` 入参 */
export const historyClearPayloadSchema = z.object({})

/** `video-download:mark-pause` 入参（暂停意图登记，配合通用 cancel 区分 PAUSED/CANCELLED） */
export const markPausePayloadSchema = z.object({
  taskId: z.string().min(1)
})
export type MarkPausePayload = z.infer<typeof markPausePayloadSchema>

// —— Cookie 支持（二期，spec §9） ——

/** cookie 平台枚举（与 cookies.ts COOKIE_PLATFORMS 同源；zod 侧独立定义避免循环依赖） */
export const COOKIE_PLATFORM_VALUES = ['douyin', 'bilibili', 'youtube'] as const
export const cookiePlatformSchema = z.enum(COOKIE_PLATFORM_VALUES)
export type CookiePlatformSchema = z.infer<typeof cookiePlatformSchema>

/** `video-download:cookie:list` 入参（无参） */
export const cookieListPayloadSchema = z.object({})

/** cookie list 条目（脱敏：仅条数与时间，不含任何 cookie 内容） */
export const cookieListItemSchema = z.object({
  platform: cookiePlatformSchema,
  cookieCount: z.number().min(0),
  updatedAt: z.number().min(0).optional()
})
export type CookieListItem = z.infer<typeof cookieListItemSchema>

/** `video-download:cookie:set` 入参（raw ≤ 64KB，三种粘贴形态） */
export const cookieSetPayloadSchema = z.object({
  platform: cookiePlatformSchema,
  raw: z
    .string()
    .min(1)
    .max(64 * 1024)
})
export type CookieSetPayload = z.infer<typeof cookieSetPayloadSchema>

/** `video-download:cookie:remove` 入参 */
export const cookieRemovePayloadSchema = z.object({
  platform: cookiePlatformSchema
})

/** `video-download:cookie:import-browser` 入参（长任务） */
export const cookieImportBrowserPayloadSchema = z.object({
  platform: cookiePlatformSchema,
  browser: z.enum(['firefox', 'chromium-legacy'])
})
export type CookieImportBrowserPayload = z.infer<typeof cookieImportBrowserPayloadSchema>
