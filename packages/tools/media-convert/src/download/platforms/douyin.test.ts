/**
 * @file platforms/douyin.ts 单测（分享页解析、去水印与 ratio、短链解析）
 * @author cuilanchao
 * @date 2026-11-25
 * @description aweme_id 三种形态、_ROUTER_DATA 与正则兜底、playwm→play、ratio 改写/追加、异常分支
 */
import { describe, expect, it } from 'vitest'
import type { FetchPage, FetchedPage } from './common'
import {
  acquireTtwid,
  extractAwemeId,
  extractTtwid,
  parseDouyinHtml,
  ratioForPreset,
  resolveDouyin,
  withDouyinRatio
} from './douyin'

const routerHtml = (playUrl: string, desc = '标题A'): string =>
  '<html><head><title>标题A - 抖音</title></head><body><script>window._ROUTER_DATA = ' +
  `{"loaderData":{"video_(id)/page":{"videoInfoRes":{"item_list":[{"desc":"${desc}",` +
  `"video":{"play_addr":{"url_list":["${playUrl}"]}}}]}}}};` +
  '</script></body></html>'

/** 固定响应假抓页 */
const pageOf =
  (page: Partial<FetchedPage>): FetchPage =>
  () =>
    Promise.resolve({ finalUrl: '', status: 200, body: '', ...page })

describe('extractAwemeId', () => {
  it('长链/分享页/modal_id 均可提取', () => {
    expect(extractAwemeId('https://www.douyin.com/video/7300000000000000001')).toBe(
      '7300000000000000001'
    )
    expect(extractAwemeId('https://www.iesdouyin.com/share/video/7300000000000000002/')).toBe(
      '7300000000000000002'
    )
    expect(extractAwemeId('https://www.douyin.com/?modal_id=7300000000000000003')).toBe(
      '7300000000000000003'
    )
  })

  it('无 ID 返回 null', () => {
    expect(extractAwemeId('https://v.douyin.com/abc')).toBeNull()
  })
})

describe('parseDouyinHtml', () => {
  it('_ROUTER_DATA 取 desc 与首选无水印地址', () => {
    const parsed = parseDouyinHtml(
      routerHtml('https://v.example.com/playwm/?video_id=1&ratio=720p')
    )
    expect(parsed).toEqual({
      title: '标题A',
      playUrl: 'https://v.example.com/playwm/?video_id=1&ratio=720p'
    })
  })

  it('优先选择非 playwm 地址', () => {
    const html = routerHtml('https://v.example.com/play/?video_id=9')
    expect(parseDouyinHtml(html)?.playUrl).toBe('https://v.example.com/play/?video_id=9')
  })

  it('_ROUTER_DATA 缺失时退化正则抓 play_addr 块', () => {
    const html =
      '<html><title>兜底标题</title><script>var x = {"play_addr":{"url_list":["https:\\u002F\\u002Fv.example.com\\u002Fplay\\u002F?video_id=2"]}};</script></html>'
    expect(parseDouyinHtml(html)).toEqual({
      title: '兜底标题',
      playUrl: 'https://v.example.com/play/?video_id=2'
    })
  })

  it('无 play_addr 返回 null', () => {
    expect(parseDouyinHtml('<html><title>x</title></html>')).toBeNull()
  })
})

describe('withDouyinRatio', () => {
  it('playwm → play 并替换既有 ratio', () => {
    expect(withDouyinRatio('https://v.example.com/playwm/?video_id=1&ratio=720p', '1080p')).toBe(
      'https://v.example.com/play/?video_id=1&ratio=1080p'
    )
  })

  it('无 ratio 参数时追加', () => {
    expect(withDouyinRatio('https://v.example.com/play/?video_id=1', 'default')).toBe(
      'https://v.example.com/play/?video_id=1&ratio=default'
    )
    expect(withDouyinRatio('https://v.example.com/play/1.mp4', '720p')).toBe(
      'https://v.example.com/play/1.mp4?ratio=720p'
    )
  })
})

describe('ratioForPreset', () => {
  it('1080p/best → 1080p；audio-mp3 → 720p（实测 default 母版达 GB 级）', () => {
    expect(ratioForPreset('1080p')).toBe('1080p')
    expect(ratioForPreset('best')).toBe('1080p')
    expect(ratioForPreset('audio-mp3')).toBe('720p')
  })
})

describe('extractTtwid / acquireTtwid', () => {
  it('从 Set-Cookie 原文取 ttwid', () => {
    expect(extractTtwid(['ttwid=abc123; Path=/; Domain=.douyin.com'])).toBe('abc123')
    expect(extractTtwid(['__ac_nonce=x; Path=/', ' ttwid=v2; Path=/'])).toBe('v2')
  })

  it('无 setCookie / 无 ttwid 字段 → null', () => {
    expect(extractTtwid(undefined)).toBeNull()
    expect(extractTtwid(['other=1'])).toBeNull()
    expect(extractTtwid(['ttwid=; Path=/'])).toBeNull()
  })

  it('POST ttwid 注册端点并返回 cookie 值', async () => {
    const seen: { url: string; method?: string; body?: string }[] = []
    const fetchPage: FetchPage = (url, options) => {
      seen.push({ url, method: options?.method, body: options?.body })
      return Promise.resolve({
        finalUrl: url,
        status: 200,
        body: '{}',
        setCookie: ['ttwid=guest1; Path=/']
      })
    }
    expect(await acquireTtwid(fetchPage)).toBe('guest1')
    expect(seen[0]?.url).toBe('https://ttwid.bytedance.com/ttwid/union/register/')
    expect(seen[0]?.method).toBe('POST')
    expect(seen[0]?.body).toContain('"aid":1768')
  })

  it('注册失败 / 无 ttwid → null（调用方退回无 cookie 请求）', async () => {
    expect(await acquireTtwid(() => Promise.reject(new Error('net down')))).toBeNull()
    expect(await acquireTtwid(pageOf({ body: '{}' }))).toBeNull()
  })
})

describe('resolveDouyin', () => {
  it('长链直接拉分享页并组装 ratio', async () => {
    const fetchPage = pageOf({ body: routerHtml('https://v.example.com/playwm/?video_id=1') })
    const resolved = await resolveDouyin(
      'https://www.douyin.com/video/7300000000000000001',
      '1080p',
      fetchPage
    )
    expect(resolved).toEqual({
      title: '标题A',
      directUrl: 'https://v.example.com/play/?video_id=1&ratio=1080p'
    })
  })

  it('取到访客态 ttwid 后分享页请求带 Cookie 头', async () => {
    const seen: (Record<string, string> | undefined)[] = []
    const fetchPage: FetchPage = (url, options) => {
      if (url.includes('/ttwid/')) {
        return Promise.resolve({
          finalUrl: url,
          status: 200,
          body: '{}',
          setCookie: ['ttwid=abc123; Path=/; Domain=.douyin.com']
        })
      }
      seen.push(options?.headers)
      return Promise.resolve({
        finalUrl: '',
        status: 200,
        body: routerHtml('https://v.example.com/playwm/?video_id=7')
      })
    }
    const resolved = await resolveDouyin(
      'https://www.douyin.com/video/7300000000000000007',
      'audio-mp3',
      fetchPage
    )
    expect(seen[0]).toEqual({ Cookie: 'ttwid=abc123' })
    expect(resolved.directUrl).toBe('https://v.example.com/play/?video_id=7&ratio=720p')
  })

  it('短链先跟随 302 再从最终地址取 ID', async () => {
    const calls: string[] = []
    const fetchPage: FetchPage = (url) => {
      calls.push(url)
      if (url.includes('/ttwid/')) {
        return Promise.resolve({ finalUrl: url, status: 200, body: '{}' })
      }
      if (url === 'https://v.douyin.com/abc') {
        return Promise.resolve({
          finalUrl: 'https://www.douyin.com/video/7300000000000000004',
          status: 200,
          body: '<html></html>'
        })
      }
      return Promise.resolve({
        finalUrl: '',
        status: 200,
        body: routerHtml('https://v.example.com/play/?video_id=4')
      })
    }
    const resolved = await resolveDouyin('https://v.douyin.com/abc', 'best', fetchPage)
    expect(calls).toContain('https://www.iesdouyin.com/share/video/7300000000000000004/')
    expect(resolved.directUrl).toBe('https://v.example.com/play/?video_id=4&ratio=1080p')
  })

  it('无法提取 ID → VD_PROBE_FAILED', async () => {
    const fetchPage = pageOf({ finalUrl: 'https://v.douyin.com/abc', body: '<html></html>' })
    await expect(resolveDouyin('https://v.douyin.com/abc', 'best', fetchPage)).rejects.toMatchObject(
      { code: 'VD_PROBE_FAILED' }
    )
  })

  it('分享页 HTTP 4xx → VD_PROBE_FAILED', async () => {
    const fetchPage = pageOf({ status: 404 })
    await expect(
      resolveDouyin('https://www.douyin.com/video/7300000000000000005', 'best', fetchPage)
    ).rejects.toMatchObject({ code: 'VD_PROBE_FAILED' })
  })

  it('页面结构无 play_addr → VD_PROBE_FAILED（提示改版）', async () => {
    const fetchPage = pageOf({ body: '<html><title>x</title></html>' })
    await expect(
      resolveDouyin('https://www.douyin.com/video/7300000000000000006', 'best', fetchPage)
    ).rejects.toMatchObject({ code: 'VD_PROBE_FAILED' })
  })
})
