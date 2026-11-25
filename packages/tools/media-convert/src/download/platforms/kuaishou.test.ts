/**
 * @file platforms/kuaishou.ts 单测（photoId、mp4 直链分桶、过期归因）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 三种链接形态、hd15/_b_ 分桶去重、高清优先、失效/改版分支
 */
import { describe, expect, it } from 'vitest'
import type { FetchPage, FetchedPage } from './common'
import { extractPhotoId, parseKuaishouHtml, pickKuaishouUrl, resolveKuaishou } from './kuaishou'

const html =
  '<html><head><title>短视频标题 - 快手</title></head><body>' +
  '<video src="https://k.example.com/upic/_b_/sd.mp4?tag=1"></video>' +
  '<video src="https://k.example.com/upic/hd15/hd.mp4?tag=1"></video>' +
  '<video src="https://k.example.com/upic/hd15/hd.mp4?tag=2"></video>' +
  '<video src="https://k.example.com/other/clip.mp4"></video>' +
  '</body></html>'

/** 固定响应假抓页 */
const pageOf =
  (page: Partial<FetchedPage>): FetchPage =>
  () =>
    Promise.resolve({ finalUrl: '', status: 200, body: '', ...page })

describe('extractPhotoId', () => {
  it('short-video / f / photo / clientCacheKey 均可提取', () => {
    expect(extractPhotoId('https://www.kuaishou.com/short-video/3xabc123')).toBe('3xabc123')
    expect(extractPhotoId('https://www.kuaishou.com/f/xyz789')).toBe('xyz789')
    expect(extractPhotoId('https://www.kuaishou.com/photo/abc999')).toBe('abc999')
    expect(extractPhotoId('clientCacheKey=cc777_x1')).toBe('cc777')
  })

  it('无 photoId 返回 null', () => {
    expect(extractPhotoId('https://v.kuaishou.com/abc')).toBeNull()
  })
})

describe('parseKuaishouHtml', () => {
  it('按 hd15 / _b_ 分桶并按 base 去重，标题去后缀', () => {
    const links = parseKuaishouHtml(html)
    expect(links.title).toBe('短视频标题')
    expect(links.hd).toEqual(['https://k.example.com/upic/hd15/hd.mp4?tag=1'])
    expect(links.sd).toEqual(['https://k.example.com/upic/_b_/sd.mp4?tag=1'])
    expect(links.other).toEqual(['https://k.example.com/other/clip.mp4'])
  })

  it('无 mp4 时各桶为空', () => {
    const links = parseKuaishouHtml('<html><title>x</title></html>')
    expect(links).toEqual({ title: 'x', hd: [], sd: [], other: [] })
  })
})

describe('pickKuaishouUrl', () => {
  it('高清优先 → 标清 → 其余', () => {
    expect(
      pickKuaishouUrl({
        title: '',
        hd: ['hd'],
        sd: ['sd'],
        other: ['o']
      })
    ).toBe('hd')
    expect(pickKuaishouUrl({ title: '', hd: [], sd: ['sd'], other: ['o'] })).toBe('sd')
    expect(pickKuaishouUrl({ title: '', hd: [], sd: [], other: [] })).toBeNull()
  })
})

describe('resolveKuaishou', () => {
  it('成功：标题 + 高清直链', async () => {
    const resolved = await resolveKuaishou('https://v.kuaishou.com/abc', pageOf({ body: html }))
    expect(resolved).toEqual({
      title: '短视频标题',
      directUrl: 'https://k.example.com/upic/hd15/hd.mp4?tag=1'
    })
  })

  it('标题为空时回退 kuaishou', async () => {
    const resolved = await resolveKuaishou(
      'https://v.kuaishou.com/abc',
      pageOf({ body: '<video src="https://k.example.com/_b_/a.mp4"></video>' })
    )
    expect(resolved.title).toBe('kuaishou')
  })

  it('页面提示作品不存在 → VD_LINK_EXPIRED', async () => {
    await expect(
      resolveKuaishou('https://v.kuaishou.com/abc', pageOf({ body: '<html>作品不存在</html>' }))
    ).rejects.toMatchObject({ code: 'VD_LINK_EXPIRED' })
  })

  it('页面无直链且无失效提示 → VD_PROBE_FAILED', async () => {
    await expect(
      resolveKuaishou('https://v.kuaishou.com/abc', pageOf({ body: '<html>空页</html>' }))
    ).rejects.toMatchObject({ code: 'VD_PROBE_FAILED' })
  })

  it('HTTP 4xx 且空正文 → VD_PROBE_FAILED', async () => {
    await expect(
      resolveKuaishou('https://v.kuaishou.com/abc', pageOf({ status: 404, body: '  ' }))
    ).rejects.toMatchObject({ code: 'VD_PROBE_FAILED' })
  })
})
