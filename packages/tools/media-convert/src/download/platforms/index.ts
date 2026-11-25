/**
 * @file 平台分发（抖音/快手 → 分享页解析；spec/media-convert-download.md §10）
 * @author cuilanchao
 * @date 2026-11-25
 * @description URL 域名识别 → 调用对应解析器 → 统一返回「标题 + 直链 + 请求头」；
 *              非目标平台返回 null，调用方回退原有 yt-dlp 链路（零行为变更）。
 */
import { isStructuredError } from '@lumin/shared'
import type { Preset } from '../schema'
import { toolError } from '../errors'
import { MOBILE_UA, type FetchPage } from './common'
import { resolveDouyin } from './douyin'
import { resolveKuaishou } from './kuaishou'

/** 支持的分享页平台 */
export type PlatformId = 'douyin' | 'kuaishou'

/** 平台解析结果（directUrl 为最终可下载直链） */
export interface ResolvedPlatformMedia {
  platform: PlatformId
  title: string
  directUrl: string
  /** yt-dlp `--add-header` 逐项（UA + Referer，防盗链） */
  headers: string[]
}

/**
 * 按域名识别平台（含短链域名；非法 URL 返回 null）
 * @param url 用户粘贴的链接
 */
export function detectPlatform(url: string): PlatformId | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  if (host === 'douyin.com' || host.endsWith('.douyin.com') || host.endsWith('.iesdouyin.com')) {
    return 'douyin'
  }
  if (host === 'kuaishou.com' || host.endsWith('.kuaishou.com') || host.endsWith('.chenzhongtech.com')) {
    return 'kuaishou'
  }
  return null
}

/**
 * 平台 → 直链请求头（移动 UA 必须；Referer 用于防盗链校验）
 * @param platform 平台标识
 */
export function headersFor(platform: PlatformId): string[] {
  const referer = platform === 'douyin' ? 'https://www.douyin.com/' : 'https://www.kuaishou.com/'
  return [`User-Agent: ${MOBILE_UA}`, `Referer: ${referer}`]
}

/**
 * 解析平台直链：非目标平台返回 null（调用方走 yt-dlp）；解析异常统一转结构化错误
 * @param url 用户粘贴的链接
 * @param preset 格式预设
 * @param fetchPage 抓页函数（注入）
 */
export async function resolvePlatformMedia(
  url: string,
  preset: Preset,
  fetchPage: FetchPage
): Promise<ResolvedPlatformMedia | null> {
  const platform = detectPlatform(url)
  if (platform === null) return null
  try {
    const resolved =
      platform === 'douyin'
        ? await resolveDouyin(url, preset, fetchPage)
        : await resolveKuaishou(url, fetchPage)
    return {
      platform,
      title: resolved.title,
      directUrl: resolved.directUrl,
      headers: headersFor(platform)
    }
  } catch (err) {
    if (isStructuredError(err)) throw err
    const detail = err instanceof Error ? err.message : '网络请求失败'
    throw toolError('VD_PROBE_FAILED', detail)
  }
}
