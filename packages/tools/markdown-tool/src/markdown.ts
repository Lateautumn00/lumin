/**
 * @file Markdown 渲染适配层（实现上提至 `@lumin/ui/markdown.ts`）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 渲染能力由根包提供；本层仅把通用超限结果映射为工具错误码 `MD_INPUT_TOO_LONG`。
 */
import { renderMarkdown as renderMarkdownCore } from '@lumin/ui/markdown'
import type { MarkdownValue } from '@lumin/ui/markdown'
import { failure, type ToolFailure } from './errors'

export { buildHtmlDocument, escapeHtml, MARKDOWN_LIMIT } from '@lumin/ui/markdown'
export type { MarkdownValue } from '@lumin/ui/markdown'

export type MarkdownOutcome = { ok: true; value: MarkdownValue } | ToolFailure

/**
 * 渲染 Markdown 为 HTML 片段（超限时映射为工具错误码）
 * @param input Markdown 源文本
 */
export function renderMarkdown(input: string): MarkdownOutcome {
  const outcome = renderMarkdownCore(input)
  return outcome.ok ? outcome : failure('MD_INPUT_TOO_LONG')
}
