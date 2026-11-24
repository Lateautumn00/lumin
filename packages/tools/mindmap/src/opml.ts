/**
 * @file OPML 2.0 导入 / 导出
 * @author cuilanchao
 * @date 2026-11-24
 * @description 导出转义 XML 属性；导入用 DOMParser 解析 outline 嵌套，缺 text 回退 title，
 *              多顶层建虚拟根，超量/超深按上限截断并记 warning（spec §4.3）。
 */
import {
  MAX_DEPTH,
  MAX_NODES,
  defaultNewId,
  sanitizeDocument,
  type MindmapNode,
  type SanitizeResult
} from './contract'
import { toolError } from './errors'

/** 与 DOM 解耦的 outline 树（便于纯函数单测） */
export interface OutlineNode {
  text: string
  note?: string
  url?: string
  expanded?: boolean
  children: OutlineNode[]
}

/** XML 属性转义 */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;'
    }
    return map[char] ?? char
  })
}

/** 单节点大纲标签（递归） */
function outlineTag(node: MindmapNode, indentLevel: number): string {
  const pad = '  '.repeat(indentLevel)
  const attrs = [`text="${escapeXml(node.topic)}"`]
  if (node.note !== undefined && node.note !== '') attrs.push(`_note="${escapeXml(node.note)}"`)
  if (node.hyperLink !== undefined) attrs.push(`url="${escapeXml(node.hyperLink)}"`)
  if (node.expanded === false) attrs.push('_expanded="false"')
  const children = node.children ?? []
  if (children.length === 0) return `${pad}<outline ${attrs.join(' ')} />`
  const inner = children.map((child) => outlineTag(child, indentLevel + 1))
  return [`${pad}<outline ${attrs.join(' ')}>`, ...inner, `${pad}</outline>`].join('\n')
}

/**
 * 导出 OPML 2.0
 * @param input 文档来源
 */
export function exportOpml(input: unknown): string {
  const { data } = sanitizeDocument(input)
  const root = data.nodeData
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `  <head><title>${escapeXml(root.topic)}</title></head>`,
    '  <body>',
    outlineTag(root, 2),
    '  </body>',
    '</opml>',
    ''
  ].join('\n')
}

/** 按上限截断的 outline 树 → 节点树 */
function outlineToNode(
  outline: OutlineNode,
  newId: () => string,
  counter: { total: number },
  depth: number,
  warnings: Set<string>
): MindmapNode | null {
  if (depth > MAX_DEPTH) {
    warnings.add('层级超过上限，已截断')
    return null
  }
  counter.total += 1
  if (counter.total > MAX_NODES) {
    warnings.add('节点数超过上限，已截断')
    return null
  }
  const node: MindmapNode = {
    id: newId(),
    topic: outline.text.trim() === '' ? '未命名' : outline.text,
    expanded: outline.expanded !== false,
    children: []
  }
  if (outline.note !== undefined && outline.note !== '') node.note = outline.note
  if (outline.url !== undefined && outline.url !== '') node.hyperLink = outline.url
  for (const child of outline.children) {
    const converted = outlineToNode(child, newId, counter, depth + 1, warnings)
    if (converted !== null) node.children?.push(converted)
  }
  return node
}

/**
 * outline 树 → 文档（纯函数，测试入口）
 * @param outlines 顶层 outline 列表
 * @param newId id 生成器
 */
export function outlinesToDocument(
  outlines: OutlineNode[],
  newId: () => string = defaultNewId
): SanitizeResult {
  if (outlines.length === 0) throw toolError('MM_IMPORT_INVALID')
  const warnings = new Set<string>()
  const counter = { total: 0 }
  const nodes: MindmapNode[] = []
  for (const outline of outlines) {
    const node = outlineToNode(outline, newId, counter, 1, warnings)
    if (node !== null) nodes.push(node)
  }
  if (nodes.length === 0) throw toolError('MM_IMPORT_INVALID')

  let root: MindmapNode
  if (nodes.length === 1) {
    root = nodes[0] as MindmapNode
  } else {
    warnings.add('检测到多个顶层节点，已归入「导入导图」')
    root = { id: newId(), topic: '导入导图', expanded: true, children: nodes }
  }

  const sanitized = sanitizeDocument({ nodeData: root, direction: 2 }, newId)
  return { data: sanitized.data, warnings: [...warnings, ...sanitized.warnings] }
}

/** DOM element → outline 树 */
function elementToOutline(element: Element): OutlineNode {
  const attrs = element.attributes
  const read = (name: string): string | undefined => {
    const value = attrs.getNamedItem(name)?.nodeValue
    return value === null || value === undefined ? undefined : value
  }
  const children: OutlineNode[] = []
  for (const child of Array.from(element.children)) {
    if (child.tagName.toLowerCase() === 'outline') children.push(elementToOutline(child))
  }
  const outline: OutlineNode = {
    text: (read('text') ?? read('title') ?? '').trim(),
    children
  }
  const note = read('_note')
  if (note !== undefined) outline.note = note
  const url = read('url')
  if (url !== undefined) outline.url = url
  if (read('_expanded') === 'false') outline.expanded = false
  return outline
}

/**
 * 解析 OPML 文本（渲染进程 DOMParser）
 * @param xml OPML 文本
 * @param newId id 生成器
 */
export function importOpml(xml: string, newId: () => string = defaultNewId): SanitizeResult {
  if (typeof DOMParser === 'undefined') throw toolError('MM_IMPORT_INVALID', 'DOMParser 不可用')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror') !== null) throw toolError('MM_IMPORT_INVALID')
  const docElement = doc.documentElement
  const bodies = docElement.getElementsByTagName('body')
  const body = bodies[0] ?? docElement
  const outlines: OutlineNode[] = []
  for (const child of Array.from(body.children)) {
    if (child.tagName.toLowerCase() === 'outline') outlines.push(elementToOutline(child))
  }
  return outlinesToDocument(outlines, newId)
}
