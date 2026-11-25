/**
 * @file 快手分享页 SSR 解析（yt-dlp 无内置 extractor，spec/media-convert-download.md §10.2）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 短链/长链/App 分享页 HTML 内联 mp4 直链提取，按 `hd15`/`_hd` 与 `_b_`
 *              区分高清/标清；token 过期、作品删除映射为结构化错误。纯函数 + 注入抓页。
 */
import { toolError } from '../errors'
import {
  htmlTitle,
  PAGE_TIMEOUT_MS,
  unescapeUrl,
  type FetchPage
} from './common'

/** 分享页直链分类结果（按清晰度分桶，未识别归 other） */
export interface KuaishouLinks {
  /** 页面标题（已去 `- 快手` 后缀） */
  title: string
  /** 高清（文件名含 hd15 / _hd） */
  hd: string[]
  /** 标清（文件名含 _b_） */
  sd: string[]
  /** 其余 mp4 直链 */
  other: string[]
}

/** 页面提示内容已不可用（token 过期/作品删除/地区限制） */
const EXPIRED_HINT = /作品不存在|已删除|页面不存在|链接已失效|内容不可见|内容已下架/i

/**
 * 从链接或页面正文提取 photoId
 * @param text 用户链接、302 后地址或页面正文
 */
export function extractPhotoId(text: string): string | null {
  const byPath = text.match(/\/(?:short-video|f|photo)\/([A-Za-z0-9_-]{6,})/)
  if (byPath !== null) return byPath[1] ?? null
  const byCache = text.match(/clientCacheKey=([A-Za-z0-9]+)/)
  return byCache === null ? null : (byCache[1] ?? null)
}

/**
 * 解析快手分享页：标题 + 去重后的 mp4 直链分桶
 * @param html 分享页正文
 */
export function parseKuaishouHtml(html: string): KuaishouLinks {
  const seen = new Set<string>()
  const all: string[] = []
  for (const raw of html.match(/https?:\/\/[^\s"']+?\.mp4(?:\?[^\s"']+)?/g) ?? []) {
    const url = unescapeUrl(raw).replace(/[\\",}]+$/, '')
    const base = url.split('?')[0] ?? url
    if (base === '' || seen.has(base)) continue
    seen.add(base)
    all.push(url)
  }
  const hd = all.filter((u) => /hd15|_hd/i.test(u))
  const sd = all.filter((u) => /_b_/i.test(u))
  const other = all.filter((u) => !hd.includes(u) && !sd.includes(u))
  const title = htmlTitle(html).replace(/\s*-\s*快手.*$/, '')
  return { title, hd, sd, other }
}

/**
 * 按清晰度优先级选择直链：高清 → 标清 → 其余
 * @param links parseKuaishouHtml 的分桶结果
 */
export function pickKuaishouUrl(links: KuaishouLinks): string | null {
  return links.hd[0] ?? links.sd[0] ?? links.other[0] ?? null
}

/**
 * 解析快手链接为「标题 + 直链」
 * @param url 用户粘贴的链接
 * @param fetchPage 抓页函数（注入）
 */
export async function resolveKuaishou(
  url: string,
  fetchPage: FetchPage
): Promise<{ title: string; directUrl: string }> {
  const page = await fetchPage(url, { timeoutMs: PAGE_TIMEOUT_MS })
  if (page.status >= 400 && page.body.trim() === '') {
    throw toolError('VD_PROBE_FAILED', `分享页 HTTP ${page.status}`)
  }
  const links = parseKuaishouHtml(page.body)
  const directUrl = pickKuaishouUrl(links)
  if (directUrl === null) {
    if (EXPIRED_HINT.test(page.body)) throw toolError('VD_LINK_EXPIRED')
    throw toolError('VD_PROBE_FAILED', '快手分享页未找到视频直链（可能已改版）')
  }
  return { title: links.title === '' ? 'kuaishou' : links.title, directUrl }
}
