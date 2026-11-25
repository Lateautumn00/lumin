/**
 * @file 平台解析公共件（移动 UA、抓页类型、标题安全化；纯函数无副作用）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 抖音/快手分享页 SSR 解析共用：fetchPage 注入类型、iPhone UA 常量、
 *              文件名主名清洗与 URL 反斜杠转义还原（spec/media-convert-download.md §10）
 */

/**
 * 移动 UA：抖音/快手分享页仅在移动 UA 下内联播放直链
 * （2026-09 第三方开源实现实测；桌面 UA 常返回不含直链的空壳页）
 */
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

/** 分享页抓取结果（finalUrl 为跟随 302 后的地址，用于短链解析视频 ID） */
export interface FetchedPage {
  /** 跟随重定向后的最终地址 */
  finalUrl: string
  /** HTTP 状态码 */
  status: number
  /** 响应正文（UTF-8 解码） */
  body: string
  /** 响应 Set-Cookie 原文（抖音访客态 ttwid 从此提取；无则缺省） */
  setCookie?: string[]
}

/** 抓页可选项：GET 抓页面 / POST 取访客态会话 */
export interface FetchPageOptions {
  /** 超时毫秒（缺省 PAGE_TIMEOUT_MS） */
  timeoutMs?: number
  /** 请求方法（缺省 GET） */
  method?: 'GET' | 'POST'
  /** 请求体（POST 用） */
  body?: string
  /** 追加/覆盖请求头（如 Cookie / Content-Type） */
  headers?: Record<string, string>
}

/** 抓页函数（主进程默认全局 fetch；单测注入假实现） */
export type FetchPage = (url: string, options?: FetchPageOptions) => Promise<FetchedPage>

/** 分享页抓取超时（spec §10：15s） */
export const PAGE_TIMEOUT_MS = 15_000

/** 分享页体积上限（5MB，防异常大页占内存） */
export const MAX_PAGE_BYTES = 5 * 1024 * 1024

/**
 * 标题 → 安全文件名主名：去 Windows 非法字符、折叠空白、去首尾点/空格，
 * 长度上限 120，空标题回退 `video`
 * @param title 平台页面标题（可为空串）
 */
export function safeFileTitle(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '')
  return cleaned === '' ? 'video' : cleaned.slice(0, 120)
}

/**
 * 还原页面内 JSON 字符串的斜杠转义（`\u002F` / `\/` / `\u0026`）
 * @param raw 页面中抓到的原始 URL 片段
 */
export function unescapeUrl(raw: string): string {
  return raw
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\')
}

/**
 * 从页面 HTML 取 `<title>` 文本（去标签、折叠空白）
 * @param html 页面正文
 */
export function htmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match === null ? '' : (match[1] ?? '').replace(/\s+/g, ' ').trim()
}
