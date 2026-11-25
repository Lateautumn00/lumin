/**
 * @file jobs.test.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description HTML 包装模板与取消/过期判定单测。
 */
import { describe, expect, it } from 'vitest'
import {
  JOB_TTL_MS,
  buildImageHtml,
  buildRasterHtml,
  escapeHtml,
  isCancelledReason,
  isStaleJob
} from './jobs'

describe('escapeHtml', () => {
  it('转义五类字符', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
    )
  })
})

describe('buildImageHtml', () => {
  it('包含 A4 @page、图片 URL 与转义后的标题', () => {
    const html = buildImageHtml({ title: 'a<b>.png', imageUrl: 'file:///C:/x/a.png' })
    expect(html).toContain('@page { size: A4; margin: 12mm; }')
    expect(html).toContain('src="file:///C:/x/a.png"')
    expect(html).toContain('<title>a&lt;b&gt;.png</title>')
    expect(html).toContain("default-src 'none'")
  })
})

describe('buildRasterHtml', () => {
  it('按页生成 section 并保留末页自动分页', () => {
    const html = buildRasterHtml({
      title: 'doc',
      imageUrls: ['file:///p1.png', 'file:///p2.png']
    })
    expect(html.match(/<section>/g)).toHaveLength(2)
    expect(html).toContain('第 2 页')
    expect(html).toContain('section:last-child { page-break-after: auto; }')
  })
})

describe('isCancelledReason', () => {
  it('忽略大小写识别 cancel', () => {
    expect(isCancelledReason('Print job canceled')).toBe(true)
    expect(isCancelledReason('CANCELLED')).toBe(true)
    expect(isCancelledReason('printer offline')).toBe(false)
    expect(isCancelledReason(undefined)).toBe(false)
  })
})

describe('isStaleJob', () => {
  it('超过 24h 判过期', () => {
    const now = 1_000 * JOB_TTL_MS
    expect(isStaleJob(now - JOB_TTL_MS - 1, now)).toBe(true)
    expect(isStaleJob(now - JOB_TTL_MS, now)).toBe(false)
  })
})
