/**
 * @file Cookie 支持核心纯函数（spec §9；覆盖率 ≥80% 分组）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 平台域名匹配、三种粘贴形态（Header 行/Netscape/裸键值）解析为 Netscape 行、
 *              序列化临时 cookie 文件内容。加密存储与浏览器读取在 node.ts / browser-cookies.ts。
 */

/** 受支持的 Cookie 平台（spec §9.1） */
export const COOKIE_PLATFORMS = ['douyin', 'bilibili', 'youtube'] as const
export type CookiePlatform = (typeof COOKIE_PLATFORMS)[number]

/** 平台 → cookie 域名匹配后缀（host_key 以此结尾即命中） */
const PLATFORM_DOMAIN_SUFFIXES: Record<CookiePlatform, readonly string[]> = {
  douyin: ['.douyin.com'],
  bilibili: ['.bilibili.com', '.bilibili.tv'],
  youtube: ['.youtube.com', '.youtu.be']
}

/** 平台 → 粘贴形态缺失 domain 时的回退域（Netscape 行 domain 字段，含前导点） */
const PLATFORM_FALLBACK_DOMAIN: Record<CookiePlatform, string> = {
  douyin: '.douyin.com',
  bilibili: '.bilibili.com',
  youtube: '.youtube.com'
}

/**
 * 按 URL 匹配 Cookie 平台（spec §9.1 域名匹配表；无匹配 → null，行为同一期）
 * @param url 视频/页面链接
 */
export function matchPlatformFor(url: string): CookiePlatform | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  for (const platform of COOKIE_PLATFORMS) {
    if (
      PLATFORM_DOMAIN_SUFFIXES[platform].some(
        (suffix) => host.endsWith(suffix.slice(1)) || host.endsWith(suffix)
      )
    ) {
      return platform
    }
  }
  return null
}

/** 单条 Netscape 行（七段 TAB 分隔，spec §9.1） */
export interface NetscapeCookieLine {
  domain: string
  includeSubdomains: boolean
  path: string
  secure: boolean
  /** Unix 秒；0 = 会话级 */
  expires: number
  name: string
  value: string
}

/**
 * 把单条 cookie 序列化为 Netscape 七段行
 * @param cookie 结构化字段
 */
export function serializeNetscapeLine(cookie: NetscapeCookieLine): string {
  return [
    cookie.domain,
    cookie.includeSubdomains ? 'TRUE' : 'FALSE',
    cookie.path || '/',
    cookie.secure ? 'TRUE' : 'FALSE',
    String(cookie.expires),
    cookie.name,
    cookie.value
  ].join('\t')
}

/** 临时 cookie 文件内容（yt-dlp --cookies 要求 Netscape 格式 + 魔法头） */
export function buildCookieFileText(lines: NetscapeCookieLine[]): string {
  return `# Netscape HTTP Cookie File\n${lines.map(serializeNetscapeLine).join('\n')}\n`
}

/** 解析结果：有效行 + 丢弃条数（过期/非法行） */
export interface ParseCookieResult {
  lines: NetscapeCookieLine[]
  dropped: number
}

/**
 * 解析粘贴的 Cookie 文本（spec §9.1 三种形态）：自动嗅探——
 * ① Netscape 文件内容（含 TAB 七段行）② DevTools `Cookie:` 头行（name=value; …）
 * ③ 裸 `name=value` 换行序列。缺 domain 用平台回退域，缺 expiry 视为会话级（0）。
 * @param raw 用户粘贴原文
 * @param platform 目标平台（回退域/域归属）
 */
export function parseCookieText(raw: string, platform: CookiePlatform): ParseCookieResult {
  const fallbackDomain = PLATFORM_FALLBACK_DOMAIN[platform]
  const lines: NetscapeCookieLine[] = []
  let dropped = 0
  const nowSec = Math.floor(Date.now() / 1000)

  /** 尝试按 Netscape 七段 TAB 行解析 */
  const parseNetscapeLine = (line: string): NetscapeCookieLine | null => {
    const parts = line.split('\t')
    if (parts.length !== 7) return null
    const [domain, includeSub, path, secure, expires, name, value] = parts.map((p) => p.trim())
    if (domain === undefined || name === undefined || value === undefined || name === '')
      return null
    const expiresNum = Number(expires)
    if (Number.isNaN(expiresNum)) return null
    if (expiresNum > 0 && expiresNum < nowSec) return null // 已过期 → 丢弃
    return {
      domain: domain.startsWith('.') ? domain : `.${domain.replace(/^\./, '')}`,
      includeSubdomains: includeSub === 'TRUE',
      path: path === undefined || path === '' ? '/' : path,
      secure: secure === 'TRUE',
      expires: expiresNum,
      name,
      value
    }
  }

  /** 按 Header 行 / 裸键值解析 name=value 序列（分号或换行分隔） */
  const parsePairs = (text: string): NetscapeCookieLine[] => {
    const result: NetscapeCookieLine[] = []
    for (const pair of text.replace(/^cookie\s*:\s*/i, '').split(/;|\r?\n/)) {
      const idx = pair.indexOf('=')
      if (idx <= 0) continue
      const name = pair.slice(0, idx).trim()
      const value = pair.slice(idx + 1).trim()
      if (name === '' || /^cookie$/i.test(name)) continue
      // 值内含非 Header 字符（如 TAB）判定为非法
      if (/\t/.test(value)) continue
      result.push({
        domain: fallbackDomain,
        includeSubdomains: true,
        path: '/',
        secure: true,
        expires: 0,
        name,
        value
      })
    }
    return result
  }

  const rawLines = raw.split(/\r?\n/)
  let sawNetscape = false
  for (const line of rawLines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('# ')) continue
    const net = trimmed.includes('\t') ? parseNetscapeLine(trimmed) : null
    if (net !== null) {
      sawNetscape = true
      lines.push(net)
      continue
    }
    if (trimmed.includes('\t')) {
      dropped += 1
      continue
    }
    if (!trimmed.includes('=')) {
      dropped += 1
      continue
    }
    lines.push(...parsePairs(trimmed))
  }
  // Netscape 模式下混入的配对行不应出现（两者互斥解析）——此处仅保证 totals 一致
  if (sawNetscape && lines.length === 0)
    dropped = rawLines.filter((l) => l.trim() !== '' && !l.startsWith('# ')).length
  return { lines, dropped }
}

/**
 * 生成 list 通道的脱敏摘要（spec §9.2：不回显任何 cookie 内容，仅条数）
 * @param cookieCount 有效条数
 */
export function cookieSummary(cookieCount: number): string {
  return cookieCount > 0 ? `已存 ${cookieCount} 条` : '未配置'
}
