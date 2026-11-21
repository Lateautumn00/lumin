/**
 * @file Markdown 渲染与文档包装单测
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import { buildHtmlDocument, escapeHtml, MARKDOWN_LIMIT, renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('渲染标题、列表、代码块、表格与链接（GFM）', () => {
    const source = [
      '# 标题',
      '',
      '- 一',
      '- 二',
      '',
      '```ts',
      'const a = 1',
      '```',
      '',
      '| 列 A | 列 B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '[链接](https://example.com)'
    ].join('\n')
    const outcome = renderMarkdown(source)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.html).toContain('<h1>标题</h1>')
    expect(outcome.value.html).toContain('<li>一</li>')
    expect(outcome.value.html).toContain('<pre><code class="language-ts">')
    expect(outcome.value.html).toContain('<table>')
    expect(outcome.value.html).toContain('href="https://example.com"')
    expect(outcome.value.chars).toBe(source.length)
    expect(outcome.value.lines).toBe(source.split('\n').length)
  })

  it('空输入与纯空白返回空 HTML 且统计准确', () => {
    expect(renderMarkdown('')).toEqual({ ok: true, value: { html: '', chars: 0, lines: 0 } })
    expect(renderMarkdown('   \n ')).toEqual({
      ok: true,
      value: { html: '', chars: 5, lines: 2 }
    })
  })

  it('超过上限返回 MD_INPUT_TOO_LONG', () => {
    const outcome = renderMarkdown('a'.repeat(MARKDOWN_LIMIT + 1))
    expect(outcome).toMatchObject({ ok: false, code: 'MD_INPUT_TOO_LONG' })
  })
})

describe('escapeHtml', () => {
  it('转义 & < > " \'', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;'
    )
  })
})

describe('buildHtmlDocument', () => {
  it('导出模式：含 doctype/charset/CSP 与联网图片许可', () => {
    const doc = buildHtmlDocument('<h1>hi</h1>', '标题')
    expect(doc).toContain('<!doctype html>')
    expect(doc).toContain('<meta charset="utf-8">')
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain('img-src data: https: http:')
    expect(doc).toContain('<h1>hi</h1>')
    expect(doc).toContain('<title>标题</title>')
  })

  it('预览模式：禁止外链资源（仅 data/blob 图片）', () => {
    const doc = buildHtmlDocument('', 'preview', 'preview')
    expect(doc).toContain('img-src data: blob:')
    expect(doc).not.toContain('https: http:')
    expect(doc).toContain("base-uri 'none'")
  })

  it('标题中的 HTML 被转义，无法逃逸 title 标签', () => {
    const doc = buildHtmlDocument('', '</title><script>alert(1)</script>')
    expect(doc).toContain('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>')
    expect(doc).not.toContain('</title><script>')
  })

  it('原始 HTML 中的脚本即使被标记透传，也受 CSP 拦截（无 script-src 放行）', () => {
    const rendered = renderMarkdown('<script>alert(1)</script>')
    expect(rendered.ok).toBe(true)
    if (!rendered.ok) return
    const doc = buildHtmlDocument(rendered.value.html, 'x', 'preview')
    expect(doc).toContain("default-src 'none'")
    expect(doc).not.toContain("script-src 'unsafe-inline'")
    expect(doc).not.toContain("'unsafe-eval'")
  })
})
