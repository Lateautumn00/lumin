/**
 * @file Markdown 大纲导入 / 导出
 * @author cuilanchao
 * @date 2026-11-24
 * @description 根为 `#`、一级为 `##`、更深层为 `- ` 列表；note 用 `> ` 行，链接用行尾 Markdown 链接；
 *              导入支持跳级修正、多顶层虚拟根与围栏代码块跳过（spec §4.2）。
 */
import {
  MAX_DEPTH,
  MAX_NODES,
  countNodes,
  defaultNewId,
  sanitizeDocument,
  treeDepth,
  type MindmapNode,
  type MindmapDocument,
  type SanitizeResult
} from './contract'
import { toolError } from './errors'

/** 解析条目（rank 为归一后的逻辑层级，根 = 0） */
interface OutlineEntry {
  rank: number
  node: MindmapNode
}

/** 行尾 Markdown 链接（`[显示文本](url)`） */
const TRAILING_LINK_RE = /^(.*?)\s*\[([^\]]+)\]\(([^)\s]+)\)\s*$/

/** 列表行（缩进 + 标记 + 内容） */
const LIST_RE = /^([ \t]*)[-*+]\s+(.*)$/

/** 标题行 */
const HEADING_RE = /^(#{1,6})\s+(.*)$/

/**
 * 拆分行尾链接：返回主题文本与链接地址
 * @param raw 行内容
 */
export function splitTrailingLink(raw: string): { text: string; link?: string } {
  const matched = TRAILING_LINK_RE.exec(raw)
  if (matched === null) return { text: raw.trim() }
  const text = (matched[1] ?? '').trim()
  return { text: text === '' ? (matched[2] ?? '').trim() : text, link: (matched[3] ?? '').trim() }
}

/** 新建空白节点（导入时直接生成合法 id，避免清洗阶段重复告警） */
function makeNode(topic: string, link: string | undefined, newId: () => string): MindmapNode {
  const node: MindmapNode = { id: newId(), topic, expanded: true, children: [] }
  if (link !== undefined && link !== '') node.hyperLink = link
  return node
}

/**
 * 解析 Markdown 大纲为文档
 * @param text Markdown 文本
 * @param newId id 生成器（测试可注入）
 */
export function importMarkdown(text: string, newId: () => string = defaultNewId): SanitizeResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const entries: OutlineEntry[] = []
  const notes: string[][] = []
  const warnings = new Set<string>()
  let inFence = false
  let headingRank = -1

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence || line.trim() === '') continue

    const heading = HEADING_RE.exec(line)
    if (heading !== null) {
      const level = (heading[1] ?? '#').length
      const { text: topic, link } = splitTrailingLink(heading[2] ?? '')
      headingRank = level - 1
      entries.push({ rank: headingRank, node: makeNode(topic, link, newId) })
      notes.push([])
      continue
    }

    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote !== null) {
      if (notes.length === 0) {
        warnings.add('顶部备注缺少归属节点，已忽略')
      } else {
        notes[notes.length - 1]?.push(quote[1] ?? '')
      }
      continue
    }

    const list = LIST_RE.exec(line)
    if (list !== null) {
      const indent = (list[1] ?? '').replace(/\t/g, '  ').length
      const base = headingRank >= 0 ? headingRank + 1 : 0
      const { text: topic, link } = splitTrailingLink(list[2] ?? '')
      entries.push({ rank: base + Math.floor(indent / 2), node: makeNode(topic, link, newId) })
      notes.push([])
    }
  }

  if (entries.length === 0) throw toolError('MM_IMPORT_INVALID')

  // 备注回填（多行以 \n 连接）
  entries.forEach((entry, index) => {
    const linesOfNote = notes[index] ?? []
    if (linesOfNote.length > 0) entry.node.note = linesOfNote.join('\n')
  })

  const stack: OutlineEntry[] = []
  const roots: MindmapNode[] = []
  for (const entry of entries) {
    const parent = stack[stack.length - 1]
    if (parent !== undefined && entry.rank > parent.rank + 1) {
      entry.rank = parent.rank + 1
      warnings.add('标题层级跳级，已按父级 +1 修正')
    }
    while (stack.length > 0 && (stack[stack.length - 1]?.rank ?? 0) >= entry.rank) stack.pop()
    const currentParent = stack[stack.length - 1]
    if (currentParent === undefined) roots.push(entry.node)
    else currentParent.node.children?.push(entry.node)
    stack.push(entry)
  }

  const root =
    roots.length === 1
      ? (roots[0] as MindmapNode)
      : makeVirtualRoot(roots, newId, warnings, '检测到多个顶层节点，已归入「导入导图」')

  assertLimits({ nodeData: root })
  const sanitized = sanitizeDocument({ nodeData: root, direction: 2 }, newId)
  return { data: sanitized.data, warnings: [...warnings, ...sanitized.warnings] }
}

/** 构造虚拟根（多顶层节点/多根 OPML 复用） */
function makeVirtualRoot(
  roots: MindmapNode[],
  newId: () => string,
  warnings: Set<string>,
  message: string
): MindmapNode {
  warnings.add(message)
  return {
    id: newId(),
    topic: '导入导图',
    expanded: true,
    children: roots
  }
}

/** 文档上限校验（Markdown 超限直接报错，OPML 走截断） */
function assertLimits(doc: MindmapDocument): void {
  if (countNodes(doc) > MAX_NODES) throw toolError('MM_NODE_LIMIT', 'nodes')
  if (treeDepth(doc) > MAX_DEPTH) throw toolError('MM_NODE_LIMIT', 'depth')
}

/** 行尾链接后缀 */
function linkSuffix(node: MindmapNode): string {
  return node.hyperLink === undefined ? '' : ` [链接](${node.hyperLink})`
}

/** 备注行（同缩进 `> ` 前缀） */
function noteLines(note: string | undefined, indent: string): string[] {
  if (note === undefined || note === '') return []
  return note.split('\n').map((line) => `${indent}> ${line}`)
}

/** 递归渲染二级及更深节点（列表） */
function renderList(node: MindmapNode, depth: number, out: string[]): void {
  const indent = '  '.repeat(Math.max(0, depth - 2))
  out.push(`${indent}- ${node.topic}${linkSuffix(node)}`)
  out.push(...noteLines(node.note, indent))
  for (const child of node.children ?? []) renderList(child, depth + 1, out)
}

/**
 * 导出 Markdown 大纲
 * @param input 文档来源
 */
export function exportMarkdown(input: unknown): string {
  const { data } = sanitizeDocument(input)
  const root = data.nodeData
  const blocks: string[] = []
  const rootLines = [`# ${root.topic}${linkSuffix(root)}`, ...noteLines(root.note, '')]
  blocks.push(rootLines.join('\n'))

  for (const child of root.children ?? []) {
    const lines: string[] = [`## ${child.topic}${linkSuffix(child)}`, ...noteLines(child.note, '')]
    for (const grandChild of child.children ?? []) renderList(grandChild, 3, lines)
    blocks.push(lines.join('\n'))
  }

  return `${blocks.join('\n\n')}\n`
}
