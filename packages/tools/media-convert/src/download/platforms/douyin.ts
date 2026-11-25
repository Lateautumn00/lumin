/**
 * @file 抖音分享页 SSR 解析（无账号、无签名，spec/media-convert-download.md §10.1）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 短链/长链/modal_id → aweme_id → 分享页 HTML → `_ROUTER_DATA` 的 play_addr；
 *              `playwm` 替换为 `play` 取默认无水印流，`ratio` 参数控制画质档位。
 *              实测（2026-11-25）：分享页仅在带访客态 `ttwid` cookie 时内联 videoInfoRes，
 *              故解析前先经字节 ttwid 注册端点取匿名会话（不涉及账号登录）。
 *              解析全部为纯函数，网络访问经注入的 FetchPage（单测不触网）。
 */
import type { Preset } from '../schema'
import { toolError } from '../errors'
import {
  htmlTitle,
  MOBILE_UA,
  PAGE_TIMEOUT_MS,
  unescapeUrl,
  type FetchPage
} from './common'

/** 抖音画质档位（分享页 `/play/?ratio=` 隐式参数） */
export const DOUYIN_RATIOS = ['default', '1080p', '720p'] as const
export type DouyinRatio = (typeof DOUYIN_RATIOS)[number]

/** 分享页基础地址（移动端 SSR 页，内联 play_addr） */
const DOUYIN_SHARE_BASE = 'https://www.iesdouyin.com/share/video'

/** 字节 ttwid 注册端点（匿名访客态会话，不含任何账号/登录信息） */
const TTWID_ENDPOINT = 'https://ttwid.bytedance.com/ttwid/union/register/'

/**
 * 从 Set-Cookie 原文提取 ttwid 值
 * @param setCookies 响应 Set-Cookie 原文数组（缺失则返回 null）
 */
export function extractTtwid(setCookies: string[] | undefined): string | null {
  if (setCookies === undefined) return null
  for (const raw of setCookies) {
    const match = raw.match(/^\s*ttwid=([^;]+)/i)
    const value = match?.[1]
    if (value !== undefined && value !== '') return value
  }
  return null
}

/**
 * 获取访客态 ttwid（抖音分享页无该 cookie 时不下发 videoInfoRes）
 * 失败返回 null，由上层退回无 cookie 请求并按解析失败归因
 * @param fetchPage 抓页函数（注入）
 */
export async function acquireTtwid(fetchPage: FetchPage): Promise<string | null> {
  try {
    const res = await fetchPage(TTWID_ENDPOINT, {
      timeoutMs: PAGE_TIMEOUT_MS,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': MOBILE_UA },
      body: JSON.stringify({
        region: 'cn',
        aid: 1768,
        needFid: false,
        service: 'www.ixigua.com',
        migrate_info: { ticket: '', source: 'node' },
        cbUrlProtocol: 'https',
        union: true
      })
    })
    return extractTtwid(res.setCookie)
  } catch {
    return null
  }
}

/**
 * 从任意文本/链接提取 aweme_id（视频 ID）
 * @param text 用户链接、302 后地址或页面正文
 */
export function extractAwemeId(text: string): string | null {
  const byPath = text.match(/(?:video|share\/video)\/(\d{6,})/)
  if (byPath !== null) return byPath[1] ?? null
  const byModal = text.match(/modal_id=(\d{6,})/)
  return byModal === null ? null : (byModal[1] ?? null)
}

/**
 * 从 `from` 起取第一个花括号平衡的 JSON 对象文本（跳过字符串内的括号）
 * @param text 页面正文
 * @param from 起始搜索位置
 */
function balancedObject(text: string, from: number): string | null {
  const start = text.indexOf('{', from)
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * 递归查找含 `video.play_addr.url_list` 的作品对象
 * @param value 已解析的 JSON 任意节点
 * @param depth 递归深度（防护异常深结构）
 */
function findAwemeItem(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 30 || value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findAwemeItem(child, depth + 1)
      if (found !== null) return found
    }
    return null
  }
  const obj = value as Record<string, unknown>
  const video = obj['video']
  if (video !== null && typeof video === 'object') {
    const play = (video as Record<string, unknown>)['play_addr']
    if (play !== null && typeof play === 'object') {
      const list = (play as Record<string, unknown>)['url_list']
      if (Array.isArray(list) && list.some((u) => typeof u === 'string' && u.startsWith('http'))) {
        return obj
      }
    }
  }
  for (const child of Object.values(obj)) {
    const found = findAwemeItem(child, depth + 1)
    if (found !== null) return found
  }
  return null
}

/**
 * 取作品对象的播放地址列表（`video.play_addr.url_list`）
 * @param item findAwemeItem 返回的作品对象
 */
function playUrlsOf(item: Record<string, unknown>): string[] {
  const video = item['video']
  if (video === null || typeof video !== 'object') return []
  const play = (video as Record<string, unknown>)['play_addr']
  if (play === null || typeof play !== 'object') return []
  const list = (play as Record<string, unknown>)['url_list']
  if (!Array.isArray(list)) return []
  return list
    .filter((u): u is string => typeof u === 'string')
    .map(unescapeUrl)
    .map((u) => u.replace(/[\\",}]+$/, ''))
    .map((u) => (u.startsWith('http://') ? `https://${u.slice('http://'.length)}` : u))
}

/**
 * 解析抖音分享页 HTML：标题 + 首选播放地址
 * 优先 `_ROUTER_DATA` JSON；结构异常时退化正则抓 `"play_addr":{...}` 块
 * @param html 分享页正文
 */
export function parseDouyinHtml(html: string): { title: string; playUrl: string } | null {
  let urls: string[] = []
  let desc = ''
  const marker = html.indexOf('_ROUTER_DATA')
  if (marker >= 0) {
    const json = balancedObject(html, marker)
    if (json !== null) {
      try {
        const item = findAwemeItem(JSON.parse(json))
        if (item !== null) {
          urls = playUrlsOf(item)
          const rawDesc = item['desc']
          if (typeof rawDesc === 'string') desc = rawDesc
        }
      } catch {
        // 非合法 JSON → 走正则兜底
      }
    }
  }
  if (urls.length === 0) {
    const block = html.match(/"play_addr"\s*:\s*\{[\s\S]*?\}\s*/)
    if (block !== null) {
      urls = (block[0].match(/https?:[^"']+/g) ?? [])
        .map(unescapeUrl)
        .map((u) => u.replace(/[\\",}]+$/, ''))
        .map((u) => (u.startsWith('http://') ? `https://${u.slice('http://'.length)}` : u))
    }
  }
  if (urls.length === 0) return null
  const playUrl = urls.find((u) => !/playwm|watermark/i.test(u)) ?? urls[0] ?? ''
  if (playUrl === '') return null
  const title = desc.trim() === '' ? htmlTitle(html).replace(/\s*-\s*抖音.*$/, '') : desc.trim()
  return { title, playUrl }
}

/**
 * 组装最终直链：`playwm` → `play`（默认无水印）+ 写入画质 `ratio`
 * @param playUrl 分享页给出的播放地址
 * @param ratio 目标画质档位
 */
export function withDouyinRatio(playUrl: string, ratio: DouyinRatio): string {
  const noWatermark = playUrl.replace(/playwm/gi, 'play')
  if (/[?&]ratio=[^&]*/.test(noWatermark)) {
    return noWatermark.replace(/ratio=[^&]*/, `ratio=${ratio}`)
  }
  const sep = noWatermark.includes('?') ? '&' : '?'
  return `${noWatermark}${sep}ratio=${ratio}`
}

/**
 * 预设 → 抖音画质档位
 * 实测（2026-11-25）：`default`（原始母版）单条可达 1GB 级，而 1080p 已是无水印最高兼容档，
 * 故 best/1080p 统一取 1080p；音频提取取 720p 省流量（音轨一致）
 * @param preset 格式预设
 */
export function ratioForPreset(preset: Preset): DouyinRatio {
  return preset === 'audio-mp3' ? '720p' : '1080p'
}

/**
 * 解析抖音链接为「标题 + 直链」
 * @param url 用户粘贴的链接（短链/长链/modal_id/iesdouyin 分享页）
 * @param preset 格式预设
 * @param fetchPage 抓页函数（注入）
 */
export async function resolveDouyin(
  url: string,
  preset: Preset,
  fetchPage: FetchPage
): Promise<{ title: string; directUrl: string }> {
  const ttwid = await acquireTtwid(fetchPage)
  const headers = ttwid === null ? undefined : { Cookie: `ttwid=${ttwid}` }
  let awemeId = extractAwemeId(url)
  let pageHtml = ''
  if (awemeId === null) {
    const first = await fetchPage(url, { timeoutMs: PAGE_TIMEOUT_MS, ...(headers && { headers }) })
    if (first.status >= 400) throw toolError('VD_PROBE_FAILED', `分享页 HTTP ${first.status}`)
    awemeId = extractAwemeId(first.finalUrl) ?? extractAwemeId(first.body)
    pageHtml = first.body
  }
  if (awemeId === null) throw toolError('VD_PROBE_FAILED', '无法解析抖音视频 ID')

  let parsed = pageHtml === '' ? null : parseDouyinHtml(pageHtml)
  if (parsed === null) {
    const share = await fetchPage(`${DOUYIN_SHARE_BASE}/${awemeId}/`, {
      timeoutMs: PAGE_TIMEOUT_MS,
      ...(headers && { headers })
    })
    if (share.status >= 400) throw toolError('VD_PROBE_FAILED', `分享页 HTTP ${share.status}`)
    parsed = parseDouyinHtml(share.body)
  }
  if (parsed === null) {
    throw toolError(
      'VD_PROBE_FAILED',
      ttwid === null
        ? '未能获取抖音访客态会话，请稍后重试或改用 cookies 导入'
        : '抖音分享页结构已变化，请升级应用后重试'
    )
  }
  return { title: parsed.title, directUrl: withDouyinRatio(parsed.playUrl, ratioForPreset(preset)) }
}
