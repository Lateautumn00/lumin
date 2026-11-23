/**
 * @file Markdown → HTML 纯函数（marked 解析 + 安全文档包装）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 预览与导出共用渲染；文档注入 CSP meta，预览另加 sandbox iframe，
 *              双重保证 Markdown 中的脚本无法执行、外链资源受控。
 */
import { marked } from 'marked'

/** 单次输入字符上限 */
export const MARKDOWN_LIMIT = 2_000_000

/** 渲染成功结果 */
export interface MarkdownValue {
  /** 渲染后的片段 HTML */
  html: string
  /** 输入字符数 */
  chars: number
  /** 输入行数（按 \n 计数） */
  lines: number
}

/** 渲染结果：超限时返回通用原因，由调用方映射自身错误码 */
export type MarkdownResult =
  { ok: true; value: MarkdownValue } | { ok: false; reason: 'INPUT_TOO_LONG' }

/** 预览文档 CSP：不加载任何外部资源，仅允许内联样式与 data/blob 图片 */
const PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

/** 导出文档 CSP：允许打开后加载 http(s)/data 图片与内联样式，脚本一律禁止 */
const EXPORT_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data: https: http:',
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

/** 预览/导出共用排版样式（含暗色适配；不依赖宿主 tokens） */
const DOCUMENT_STYLES = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 16px 20px 40px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  line-height: 1.7;
  color: #1f2328;
  background: #ffffff;
  word-wrap: break-word;
}
h1, h2, h3, h4, h5, h6 { margin: 1.2em 0 0.6em; line-height: 1.3; font-weight: 600; }
h1 { font-size: 1.8em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
h2 { font-size: 1.45em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
h3 { font-size: 1.2em; }
p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
ul, ol { padding-left: 1.6em; }
li + li { margin-top: 0.25em; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
code {
  font-family: 'Cascadia Code', Consolas, 'Courier New', monospace;
  font-size: 0.9em;
  padding: 0.15em 0.35em;
  border-radius: 4px;
  background: rgba(175, 184, 193, 0.25);
}
pre {
  padding: 12px 14px;
  overflow: auto;
  border-radius: 6px;
  background: #f6f8fa;
}
pre code { padding: 0; background: transparent; }
blockquote {
  margin-left: 0;
  padding: 0 1em;
  color: #57606a;
  border-left: 4px solid #d0d7de;
}
table { border-collapse: collapse; width: 100%; }
th, td { padding: 6px 12px; border: 1px solid #d0d7de; }
th { background: #f6f8fa; font-weight: 600; }
img { max-width: 100%; }
hr { height: 1px; border: 0; background: #d0d7de; margin: 1.5em 0; }
@media (prefers-color-scheme: dark) {
  body { color: #e6edf3; background: #0d1117; }
  h1, h2 { border-bottom-color: #30363d; }
  a { color: #4493f8; }
  code { background: rgba(110, 118, 129, 0.4); }
  pre { background: #161b22; }
  blockquote { color: #9198a1; border-left-color: #3d444d; }
  th, td { border-color: #3d444d; }
  th { background: #161b22; }
  hr { background: #3d444d; }
}
`.trim()

/**
 * 转义 HTML 文本（用于标题等插入位置）
 * @param value 原始文本
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 渲染 Markdown 为 HTML 片段
 * @param input Markdown 源文本
 */
export function renderMarkdown(input: string): MarkdownResult {
  if (input.length > MARKDOWN_LIMIT) return { ok: false, reason: 'INPUT_TOO_LONG' }
  const chars = input.length
  const lines = input === '' ? 0 : input.split('\n').length
  if (input.trim() === '') return { ok: true, value: { html: '', chars, lines } }
  const html = marked.parse(input, { gfm: true, breaks: false, async: false }) as string
  return { ok: true, value: { html, chars, lines } }
}

/**
 * 包装完整 HTML 文档（预览 iframe / 导出文件共用）
 * @param bodyHtml 片段 HTML
 * @param title 文档标题（自动转义）
 * @param mode 目标：preview 不加载外链资源，export 允许外链图片
 */
export function buildHtmlDocument(
  bodyHtml: string,
  title: string,
  mode: 'preview' | 'export' = 'export'
): string {
  const csp = mode === 'preview' ? PREVIEW_CSP : EXPORT_CSP
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${escapeHtml(title)}</title>
<style>
${DOCUMENT_STYLES}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`
}
