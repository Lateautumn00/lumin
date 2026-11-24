/**
 * @file pdf-html.test.ts PDF 版面行 → HTML 纯函数单测（标题/段落/列表/转义）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖 M63（P1-11）：escapeHtml/joinText/headingSizes 与 buildHtmlDocument 结构
 */
import { describe, expect, it } from 'vitest'
import type { PdfTextLine } from '@lumin/node-kit/pdf'
import { buildHtmlDocument, escapeHtml, headingSizes, joinText } from './pdf-html'

/** 造版面行（默认字号 12、x=40） */
function line(
  text: string,
  y: number,
  overrides: Partial<PdfTextLine> = {}
): PdfTextLine {
  return {
    pageNumber: 1,
    text,
    x: 40,
    y,
    fontSize: 12,
    fontName: 'F1',
    ...overrides
  }
}

describe('escapeHtml', () => {
  it('转义五类特殊字符', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
    )
  })

  it('空串原样返回', () => {
    expect(escapeHtml('')).toBe('')
  })
})

describe('joinText', () => {
  it('两侧均为 ASCII 单词字符时补空格', () => {
    expect(joinText('hello', 'world')).toBe('hello world')
  })

  it('中文或标点直接拼接', () => {
    expect(joinText('第一行。', '第二行')).toBe('第一行。第二行')
    expect(joinText('第 1 行', '末尾')).toBe('第 1 行末尾')
  })

  it('空串侧直接返回另一侧', () => {
    expect(joinText('', 'abc')).toBe('abc')
    expect(joinText('abc', '')).toBe('abc')
  })
})

describe('headingSizes', () => {
  it('排除最频繁的正文号后按字号降序，最多三级', () => {
    const pages = [
      {
        pageNumber: 1,
        lines: [line('标题', 700, { fontSize: 18 }), line('正文', 680, { fontSize: 12 })]
      },
      {
        pageNumber: 2,
        lines: [line('小字', 700, { fontSize: 9 }), line('再次', 680, { fontSize: 12 })]
      }
    ]
    expect(headingSizes(pages)).toEqual([18, 9])
  })

  it('只有单一字号时无标题候选', () => {
    expect(
      headingSizes([{ pageNumber: 1, lines: [line('正文一', 700), line('正文二', 686)] }])
    ).toEqual([])
  })

  it('忽略空行与 0 字号', () => {
    expect(
      headingSizes([
        { pageNumber: 1, lines: [line('   ', 700, { fontSize: 20 }), line('x', 680, { fontSize: 0 })] }
      ])
    ).toEqual([])
  })
})

describe('buildHtmlDocument', () => {
  it('单字号文档不推断标题，段落按相邻行合并', () => {
    const html = buildHtmlDocument({
      title: 'doc',
      pages: [
        {
          pageNumber: 1,
          lines: [line('正文第一行', 700), line('正文第二行', 686)]
        }
      ]
    })
    expect(html).not.toMatch(/<h[123]>/)
    expect(html).toContain('<p>正文第一行正文第二行</p>')
  })

  it('多字号按分位输出 h1/h2，超长行按正文处理', () => {
    const longText = 'A'.repeat(130)
    const html = buildHtmlDocument({
      title: 'doc',
      pages: [
        {
          pageNumber: 1,
          lines: [
            line('第一章 概述', 700, { fontSize: 18 }),
            line('小节标题', 660, { fontSize: 14 }),
            line(longText, 620, { fontSize: 18 }),
            line('正文一', 600),
            line('正文二', 586),
            line('正文三', 572),
            line('正文四', 558)
          ]
        }
      ]
    })
    expect(html).toContain('<h1>第一章 概述</h1>')
    expect(html).toContain('<h2>小节标题</h2>')
    expect(html).not.toContain(`<h1>${longText}</h1>`)
    expect(html).toContain(`<p>${longText}正文一正文二正文三正文四</p>`)
  })

  it('行距过大或缩进增大时分段', () => {
    const html = buildHtmlDocument({
      title: 'doc',
      pages: [
        {
          pageNumber: 1,
          lines: [
            line('第一段', 700),
            line('第二段', 640),
            line('缩进段', 630, { x: 200 })
          ]
        }
      ]
    })
    expect(html).toContain('<p>第一段</p>')
    expect(html).toContain('<p>第二段</p>')
    expect(html).toContain('<p>缩进段</p>')
  })

  it('项目符号与序号分别归并为 ul/ol', () => {
    const html = buildHtmlDocument({
      title: 'doc',
      pages: [
        {
          pageNumber: 1,
          lines: [
            line('• 项目一', 700),
            line('• 项目二', 686),
            line('1. 有序一', 672),
            line('2) 有序二', 658)
          ]
        }
      ]
    })
    expect(html).toContain('<ul>\n  <li>项目一</li>\n  <li>项目二</li>\n</ul>')
    expect(html).toContain('<ol>\n  <li>有序一</li>\n  <li>有序二</li>\n</ol>')
  })

  it('输出文档骨架、转义标题与页码区块，空页跳过', () => {
    const html = buildHtmlDocument({
      title: `<样本> & "引号"`,
      pages: [
        { pageNumber: 1, lines: [line('内容', 700)] },
        { pageNumber: 2, lines: [] },
        { pageNumber: 3, lines: [line('末页', 700)] }
      ]
    })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>&lt;样本&gt; &amp; &quot;引号&quot;</title>')
    expect(html).toContain('<div class="page-label">第 1 页</div>')
    expect(html).toContain('<div class="page-label">第 3 页</div>')
    expect(html).not.toContain('第 2 页')
    expect(html).not.toContain('<script')
    expect(html.trimEnd().endsWith('</html>')).toBe(true)
  })
})
