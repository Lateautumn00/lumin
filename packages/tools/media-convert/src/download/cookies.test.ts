/**
 * @file cookies.ts 单测（核心纯函数，覆盖率 ≥80% 分组；spec §9.1/§9.2）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 平台域名匹配 / 三种粘贴形态解析 / Netscape 序列化 / 脱敏摘要
 */
import { describe, expect, it } from 'vitest'
import {
  buildCookieFileText,
  cookieSummary,
  matchPlatformFor,
  parseCookieText,
  serializeNetscapeLine
} from './cookies'

describe('matchPlatformFor', () => {
  it('B站视频页 → bilibili', () => {
    expect(matchPlatformFor('https://www.bilibili.com/video/BV1GJ411x7h7/')).toBe('bilibili')
  })

  it('抖音短链/分享页 → douyin', () => {
    expect(matchPlatformFor('https://v.douyin.com/na3SyHkTkJo/')).toBe('douyin')
    expect(matchPlatformFor('https://www.douyin.com/video/7709077103354881957')).toBe('douyin')
  })

  it('YouTube → youtube', () => {
    expect(matchPlatformFor('https://www.youtube.com/watch?v=abc')).toBe('youtube')
    expect(matchPlatformFor('https://youtu.be/abc')).toBe('youtube')
  })

  it('其余平台 → null（行为同一期）', () => {
    expect(matchPlatformFor('https://example.com/video/1')).toBeNull()
    expect(matchPlatformFor('不是链接')).toBeNull()
  })
})

describe('parseCookieText', () => {
  it('Header 行（DevTools Cookie: 前缀 + 分号分隔）→ 平台回退域', () => {
    const { lines, dropped } = parseCookieText('Cookie: a=1; b=2; SESSDATA=xyz', 'bilibili')
    expect(dropped).toBe(0)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ domain: '.bilibili.com', name: 'a', value: '1', expires: 0 })
    expect(lines[2]).toMatchObject({ name: 'SESSDATA', value: 'xyz' })
  })

  it('裸键值换行序列 → 平台回退域', () => {
    const { lines } = parseCookieText('a=1\nb=2', 'douyin')
    expect(lines).toHaveLength(2)
    expect(lines[0]?.domain).toBe('.douyin.com')
  })

  it('Netscape 文件内容（TAB 七段）→ 原样保留 domain/expiry', () => {
    const raw = [
      '# Netscape HTTP Cookie File',
      '.douyin.com\tTRUE\t/\tTRUE\t1893456000\tsessionid\tabc',
      '.douyin.com\tTRUE\t/\tFALSE\t0\tttwid\tefg'
    ].join('\n')
    const { lines, dropped } = parseCookieText(raw, 'douyin')
    expect(dropped).toBe(0)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      domain: '.douyin.com',
      name: 'sessionid',
      value: 'abc',
      expires: 1893456000
    })
    expect(lines[1]).toMatchObject({ name: 'ttwid', expires: 0 })
  })

  it('已过期的 Netscape 行 → 丢弃', () => {
    const raw = '.douyin.com\tTRUE\t/\tTRUE\t1000\told\tv'
    const { lines, dropped } = parseCookieText(raw, 'douyin')
    expect(lines).toHaveLength(0)
    expect(dropped).toBe(1)
  })

  it('非法行（无 = / TAB 残值）→ 丢弃计数', () => {
    const { lines, dropped } = parseCookieText('novalue\na=1', 'youtube')
    expect(lines).toHaveLength(1)
    expect(dropped).toBe(1)
  })

  it('全部非法 → lines 空（调用方报 VD_COOKIE_FORMAT_INVALID）', () => {
    expect(parseCookieText('garbage', 'douyin').lines).toHaveLength(0)
  })
})

describe('序列化与摘要', () => {
  it('buildCookieFileText 输出魔法头 + TAB 行', () => {
    const text = buildCookieFileText([
      {
        domain: '.douyin.com',
        includeSubdomains: true,
        path: '/',
        secure: true,
        expires: 0,
        name: 'a',
        value: '1'
      }
    ])
    expect(text).toContain('# Netscape HTTP Cookie File')
    expect(text).toContain('.douyin.com\tTRUE\t/\tTRUE\t0\ta\t1')
  })

  it('serializeNetscapeLine path 缺省用 /', () => {
    expect(
      serializeNetscapeLine({
        domain: '.x.com',
        includeSubdomains: false,
        path: '',
        secure: false,
        expires: 5,
        name: 'n',
        value: 'v'
      })
    ).toBe('.x.com\tFALSE\t/\tFALSE\t5\tn\tv')
  })

  it('cookieSummary 脱敏：仅条数', () => {
    expect(cookieSummary(0)).toBe('未配置')
    expect(cookieSummary(23)).toBe('已存 23 条')
  })
})
