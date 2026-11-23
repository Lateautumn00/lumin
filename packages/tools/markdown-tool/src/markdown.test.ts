/**
 * @file Markdown 适配层单测：通用渲染结果 → 工具错误码映射
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import { buildHtmlDocument, escapeHtml, MARKDOWN_LIMIT, renderMarkdown } from './markdown'

describe('renderMarkdown 适配', () => {
  it('成功结果原样透传', () => {
    const outcome = renderMarkdown('# 标题')
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.html).toContain('<h1>标题</h1>')
  })

  it('超过上限映射为 MD_INPUT_TOO_LONG', () => {
    const outcome = renderMarkdown('a'.repeat(MARKDOWN_LIMIT + 1))
    expect(outcome).toMatchObject({ ok: false, code: 'MD_INPUT_TOO_LONG' })
  })
})

describe('re-export 完整性', () => {
  it('escapeHtml 与 buildHtmlDocument 可用', () => {
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;')
    expect(buildHtmlDocument('<p>x</p>', 't')).toContain('<p>x</p>')
  })
})
