/**
 * @file pdf-html.ts PDF 版面行 → 单文件 HTML（纯函数，无外部资源/脚本）
 * @author cuilanchao
 * @date 2026-11-24
 * @description M63（P1-11）：按字号分位推断标题层级、按行距与缩进合并段落、
 *              按 `•/-/1.` 前缀识别列表；输出自带内联样式的 UTF-8 HTML。
 *              所有文本均经 HTML 转义，禁止注入 `<script>`。
 */
import type { PdfTextLine } from '@lumin/node-kit/pdf'

/** 单页版面输入 */
export interface HtmlPageInput {
  pageNumber: number
  lines: readonly PdfTextLine[]
}

/** 文档输入 */
export interface HtmlDocumentInput {
  title: string
  pages: readonly HtmlPageInput[]
}

/** HTML 块（段落/标题/列表） */
type HtmlBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }

/** 标题最大文本长度（超长行一律按正文处理） */
const MAX_HEADING_LENGTH = 120

/** 段落间距阈值（相对字号倍数，超过即分段） */
const PARAGRAPH_GAP_RATIO = 1.8

/** 缩进分段阈值（相对字号倍数） */
const PARAGRAPH_INDENT_RATIO = 2

/** 无序列表前缀 */
const BULLET_RE = /^[•·▪◦*\-]\s+(.*)$/

/** 有序列表前缀（`1.` / `1)` / `1、`） */
const ORDERED_RE = /^\d{1,3}[.)、]\s+(.*)$/

/** ASCII 词尾（跨行合并时判断是否需要补空格） */
const WORD_END_RE = /[A-Za-z0-9]$/

/** ASCII 词首 */
const WORD_START_RE = /^[A-Za-z0-9]/

/**
 * HTML 转义（& < > " '），防止 PDF 文本注入标签或脚本
 * @param value 原始文本
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** 字号归一到 0.1（避免浮点抖动影响分位） */
function roundSize(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * 统计文档字号：出现最频繁的字号视为正文字号并排除，其余按降序取前三级作为标题候选
 * @param pages 版面行
 */
export function headingSizes(pages: readonly HtmlPageInput[]): number[] {
  const counts = new Map<number, number>()
  for (const page of pages) {
    for (const line of page.lines) {
      if (line.text.trim() === '' || line.fontSize <= 0) continue
      const size = roundSize(line.fontSize)
      counts.set(size, (counts.get(size) ?? 0) + 1)
    }
  }
  if (counts.size < 2) return []
  let bodySize = 0
  let bodyCount = -1
  for (const [size, count] of counts) {
    if (count > bodyCount || (count === bodyCount && size < bodySize)) {
      bodySize = size
      bodyCount = count
    }
  }
  return [...counts.keys()]
    .filter((size) => size !== bodySize)
    .sort((left, right) => right - left)
    .slice(0, 3)
}

/**
 * 判断某行是否为标题（字号需命中候选且文本不过长）
 * @param line 版面行
 * @param sizes 标题字号候选（降序）
 */
function headingLevel(line: PdfTextLine, sizes: readonly number[]): 0 | 1 | 2 | 3 {
  if (sizes.length === 0) return 0
  if (line.text.trim().length > MAX_HEADING_LENGTH) return 0
  const index = sizes.indexOf(roundSize(line.fontSize))
  if (index < 0) return 0
  return (index + 1) as 1 | 2 | 3
}

/** 识别列表项前缀，返回列表类型与去前缀内容 */
function matchList(text: string): { ordered: boolean; content: string } | null {
  const bullet = BULLET_RE.exec(text)
  if (bullet !== null) return { ordered: false, content: bullet[1] ?? '' }
  const ordered = ORDERED_RE.exec(text)
  if (ordered !== null) return { ordered: true, content: ordered[1] ?? '' }
  return null
}

/** 跨行合并：两侧均为 ASCII 单词字符时补一个空格，其余直接拼接（适配中文） */
export function joinText(left: string, right: string): string {
  if (left === '') return right
  if (right === '') return left
  return WORD_END_RE.test(left) && WORD_START_RE.test(right) ? `${left} ${right}` : `${left}${right}`
}

/**
 * 单页版面行 → HTML 块（标题/段落/列表）
 * @param lines 版面行
 * @param sizes 标题字号候选
 */
function buildBlocks(lines: readonly PdfTextLine[], sizes: readonly number[]): HtmlBlock[] {
  const blocks: HtmlBlock[] = []
  let paragraph = ''
  let list: { ordered: boolean; items: string[] } | null = null
  let paragraphX = 0
  let lastY = 0
  let lastFont = 0

  const flushParagraph = (): void => {
    if (paragraph !== '') blocks.push({ kind: 'paragraph', text: paragraph })
    paragraph = ''
  }
  const flushList = (): void => {
    if (list !== null && list.items.length > 0) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
    }
    list = null
  }

  for (const line of lines) {
    const text = line.text.trim()
    if (text === '') continue
    const level = headingLevel(line, sizes)
    if (level === 1 || level === 2 || level === 3) {
      flushParagraph()
      flushList()
      blocks.push({ kind: 'heading', level, text })
      continue
    }
    const listed = matchList(text)
    if (listed !== null) {
      flushParagraph()
      if (list === null || list.ordered !== listed.ordered) {
        flushList()
        list = { ordered: listed.ordered, items: [] }
      }
      list.items.push(listed.content.trim())
      continue
    }
    flushList()
    if (paragraph === '') {
      paragraph = text
      paragraphX = line.x
    } else {
      const gap = lastY - line.y
      const indent = line.x - paragraphX
      const lineSize = Math.max(lastFont, line.fontSize, 1)
      const shouldBreak =
        gap > lineSize * PARAGRAPH_GAP_RATIO || indent > lineSize * PARAGRAPH_INDENT_RATIO
      if (shouldBreak) {
        flushParagraph()
        paragraph = text
        paragraphX = line.x
      } else {
        paragraph = joinText(paragraph, text)
      }
    }
    lastY = line.y
    lastFont = line.fontSize
  }
  flushParagraph()
  flushList()
  return blocks
}

/** 单块 → HTML 片段 */
function renderBlock(block: HtmlBlock): string {
  if (block.kind === 'heading') {
    return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`
  }
  if (block.kind === 'paragraph') {
    return `<p>${escapeHtml(block.text)}</p>`
  }
  const tag = block.ordered ? 'ol' : 'ul'
  const items = block.items.map((item) => `  <li>${escapeHtml(item)}</li>`).join('\n')
  return `<${tag}>\n${items}\n</${tag}>`
}

/** 内联样式（单文件自包含，明暗自适应；不引用外部资源） */
const STYLE = `:root { color-scheme: light dark; }
body { margin: 0; padding: 32px 16px; background: #f4f5f7; color: #1f2328;
  font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", system-ui, sans-serif;
  line-height: 1.75; }
main { max-width: 820px; margin: 0 auto; }
section.pdf-page { background: #fff; border-radius: 12px; padding: 28px 32px; margin-bottom: 24px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08); }
div.page-label { margin-bottom: 16px; font-size: 12px; letter-spacing: 0.08em; color: #8a9099; }
h1, h2, h3 { line-height: 1.4; margin: 0.7em 0 0.4em; }
h1 { font-size: 1.6rem; }
h2 { font-size: 1.3rem; }
h3 { font-size: 1.1rem; }
p { margin: 0.5em 0; }
ul, ol { margin: 0.5em 0; padding-left: 1.6em; }
li { margin: 0.2em 0; }
@media (prefers-color-scheme: dark) {
  body { background: #16181c; color: #e6e8eb; }
  section.pdf-page { background: #1f2228; box-shadow: none; }
  div.page-label { color: #8a9099; }
}`

/**
 * 组装单文件 HTML（含内联样式；页内块由字号/行距推断）
 * @param input 标题与版面页
 */
export function buildHtmlDocument(input: HtmlDocumentInput): string {
  const sizes = headingSizes(input.pages)
  const sections = input.pages
    .filter((page) => page.lines.length > 0)
    .map((page) => {
      const body = buildBlocks(page.lines, sizes).map(renderBlock).join('\n')
      return [
        `<section class="pdf-page" id="page-${page.pageNumber}">`,
        `<div class="page-label">第 ${page.pageNumber} 页</div>`,
        body,
        '</section>'
      ]
        .filter((part) => part !== '')
        .join('\n')
    })
    .join('\n')
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title>`,
    '<style>',
    STYLE,
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    sections,
    '</main>',
    '</body>',
    '</html>',
    ''
  ].join('\n')
}
