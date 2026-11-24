/**
 * @file 思维导图文档模型、清洗与统计纯函数
 * @author cuilanchao
 * @date 2026-11-24
 * @description 提供 sanitizeDocument / countNodes / treeDepth / collectIds / createDocument /
 *              serializeDocument / normalizeDirection；不依赖 mind-elixir，可在 Node 环境单测。
 */
import { toolError } from './errors'

/** 文档字节上限（5 MiB，spec §3.2） */
export const MAX_DOC_BYTES = 5 * 1024 * 1024
/** 草稿字节上限（2 MiB，spec §5.2） */
export const MAX_DRAFT_BYTES = 2 * 1024 * 1024
/** 节点总数上限 */
export const MAX_NODES = 5000
/** 树深度上限（根 = 1） */
export const MAX_DEPTH = 50
/** 单文件路径长度上限 */
export const MAX_PATH = 4096
/** 主题长度上限 */
export const MAX_TOPIC = 2000
/** 备注长度上限 */
export const MAX_NOTE = 5000
/** 链接长度上限 */
export const MAX_HYPERLINK = 2048
/** 标签数量 / 单项长度上限 */
export const MAX_TAGS = 10
export const MAX_TAG_LENGTH = 64
/** 样式值长度上限 */
export const MAX_STYLE_VALUE = 64
/** 每类附加对象（arrows / summaries）保留上限 */
export const MAX_EXTRA_ITEMS = 200
/** 导出文本 base64 字符上限（40 MiB 字符量） */
export const MAX_BASE64_CHARS = 40 * 1024 * 1024
/** 导出文件字节上限 */
export const MAX_EXPORT_BYTES = 40 * 1024 * 1024

/** 文档元信息标记 */
export const META_APP = 'lumin-mindmap'
export const META_VERSION = 1

/** 布局方向（与 MindElixir.LEFT/RIGHT/SIDE/DOWN 对齐） */
export type MindmapDirection = 0 | 1 | 2 | 3

/** 节点样式白名单键 */
export const STYLE_KEYS = [
  'fontSize',
  'fontFamily',
  'color',
  'background',
  'fontWeight',
  'width',
  'border',
  'textDecoration'
] as const

export type MindmapStyleKey = (typeof STYLE_KEYS)[number]

/** 节点（已清洗形态） */
export interface MindmapNode {
  id: string
  topic: string
  note?: string
  hyperLink?: string
  expanded?: boolean
  direction?: 0 | 1
  style?: Partial<Record<MindmapStyleKey, string>>
  tags?: string[]
  branchColor?: string
  children?: MindmapNode[]
}

/** 文档（原生 MindElixirData 子集，不另包信封） */
export interface MindmapDocument {
  nodeData: MindmapNode
  arrows?: Record<string, unknown>[]
  summaries?: Record<string, unknown>[]
  direction?: MindmapDirection
  meta?: Record<string, unknown>
}

/** 清洗结果 */
export interface SanitizeResult {
  data: MindmapDocument
  warnings: string[]
}

/** id 合法形态 */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** 颜色合法形态（#RGB / #RRGGBB / rgb() / rgba()） */
export const COLOR_RE =
  /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/

/** 样式值字符白名单 */
export const STYLE_VALUE_RE = /^[#a-zA-Z0-9(),.%\s-]+$/

/** 样式值禁用片段（防注入） */
const STYLE_BANNED_RE = /url\(|expression|;/i

/** 控制字符（保留 \t \n \r） */
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/** 对象判定 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 生成节点 id（32 位十六进制；无 crypto 时回退时间戳 + 随机串） */
export function defaultNewId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid !== undefined) return uuid.replace(/-/g, '').slice(0, 32)
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** 文本清洗：剔控制字符、trim、截断 */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(CONTROL_RE, '').trim().slice(0, max)
}

/** 链接校验：仅 http/https/mailto */
function cleanHyperlink(value: unknown): string | undefined {
  const text = cleanText(value, MAX_HYPERLINK)
  if (text === '') return undefined
  if (!/^(https?:|mailto:)/i.test(text)) return undefined
  try {
    if (text.toLowerCase().startsWith('mailto:')) {
      return /^mailto:[^\s@]+@[^\s@]+$/i.test(text) ? text : undefined
    }
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? text : undefined
  } catch {
    return undefined
  }
}

/** 颜色校验 */
export function isColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR_RE.test(value)
}

/** 样式清洗：仅白名单键，剔除危险片段 */
function cleanStyle(raw: unknown, warnings: Set<string>): MindmapNode['style'] {
  if (!isRecord(raw)) return undefined
  const style: Partial<Record<MindmapStyleKey, string>> = {}
  for (const key of STYLE_KEYS) {
    const value = raw[key]
    const text =
      typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
    if (text === '') continue
    if (text.length > MAX_STYLE_VALUE || !STYLE_VALUE_RE.test(text) || STYLE_BANNED_RE.test(text)) {
      warnings.add('部分节点样式不合法，已忽略')
      continue
    }
    style[key] = text
  }
  return Object.keys(style).length === 0 ? undefined : style
}

/** 标签清洗：支持 string 与 { text } 两种来源形态 */
function cleanTags(raw: unknown, warnings: Set<string>): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const tags: string[] = []
  for (const item of raw) {
    const text = cleanText(isRecord(item) ? item.text : item, MAX_TAG_LENGTH)
    if (text === '') continue
    tags.push(text)
    if (tags.length >= MAX_TAGS) break
  }
  if (tags.length === 0) return undefined
  if (tags.length < raw.length) warnings.add('部分标签超过上限，已截断')
  return tags
}

/** 附加对象数组清洗（arrows / summaries 原样保留，仅限对象数组与数量） */
function cleanExtras(
  raw: unknown,
  label: string,
  warnings: Set<string>
): Record<string, unknown>[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    warnings.add(`不支持的 ${label} 字段已忽略`)
    return undefined
  }
  const items = raw.filter(isRecord)
  if (items.length < raw.length) warnings.add(`部分 ${label} 项不是对象，已忽略`)
  if (items.length > MAX_EXTRA_ITEMS) {
    warnings.add(`${label} 超过 ${MAX_EXTRA_ITEMS} 项，已截断`)
    return items.slice(0, MAX_EXTRA_ITEMS)
  }
  return items
}

/** 单节点清洗（递归；超深/超量抛 MM_NODE_LIMIT） */
function sanitizeNode(
  raw: Record<string, unknown>,
  newId: () => string,
  seen: Set<string>,
  warnings: Set<string>,
  counter: { total: number },
  depth: number,
  isRoot: boolean
): MindmapNode {
  if (depth > MAX_DEPTH) throw toolError('MM_NODE_LIMIT', `depth=${depth}`)
  counter.total += 1
  if (counter.total > MAX_NODES) throw toolError('MM_NODE_LIMIT', `nodes=${counter.total}`)

  const rawId = typeof raw.id === 'string' ? raw.id : ''
  let id = rawId
  if (!ID_RE.test(id) || seen.has(id)) {
    id = newId()
    warnings.add('节点 id 缺失或重复，已重新生成')
  }
  seen.add(id)

  if (raw.dangerouslySetInnerHTML !== undefined) warnings.add('已剥离不支持的富文本内容')
  if (raw.image !== undefined) warnings.add('已剥离图片节点')
  if (raw.icons !== undefined) warnings.add('已剥离图标字段')
  if (raw.metadata !== undefined) warnings.add('已剥离元数据字段')

  const node: MindmapNode = {
    id,
    topic: cleanText(raw.topic, MAX_TOPIC) || '未命名',
    expanded: raw.expanded !== false
  }

  const note = cleanText(raw.note, MAX_NOTE)
  if (note !== '') node.note = note

  const hyperLink = cleanHyperlink(raw.hyperLink)
  if (hyperLink !== undefined) node.hyperLink = hyperLink
  else if (typeof raw.hyperLink === 'string' && raw.hyperLink.trim() !== '') {
    warnings.add('不支持的链接协议已丢弃')
  }

  if (!isRoot && (raw.direction === 0 || raw.direction === 1)) node.direction = raw.direction

  const style = cleanStyle(raw.style, warnings)
  if (style !== undefined) node.style = style

  const tags = cleanTags(raw.tags, warnings)
  if (tags !== undefined) node.tags = tags

  if (isColor(raw.branchColor)) node.branchColor = raw.branchColor
  else if (raw.branchColor !== undefined) warnings.add('分支颜色不合法，已忽略')

  const children: MindmapNode[] = []
  if (Array.isArray(raw.children)) {
    for (const child of raw.children) {
      if (isRecord(child)) {
        children.push(sanitizeNode(child, newId, seen, warnings, counter, depth + 1, false))
      } else {
        warnings.add('部分子节点格式不合法，已忽略')
      }
    }
  }
  node.children = children
  return node
}

/**
 * 清洗文档：剥危险/不支持字段、修 id、限长限深
 * @param input 任意来源（JSON.parse / mind-elixir getData / 草稿）
 * @param newId id 生成器（测试可注入确定性实现）
 */
export function sanitizeDocument(
  input: unknown,
  newId: () => string = defaultNewId
): SanitizeResult {
  if (!isRecord(input) || !isRecord(input.nodeData)) {
    throw toolError('MM_INVALID_DOCUMENT')
  }
  const warnings = new Set<string>()
  const seen = new Set<string>()
  const counter = { total: 0 }
  const root = sanitizeNode(input.nodeData, newId, seen, warnings, counter, 1, true)

  const arrows = cleanExtras(input.arrows, 'arrows', warnings)
  const summaries = cleanExtras(input.summaries, 'summaries', warnings)
  const data: MindmapDocument = {
    nodeData: root,
    ...(arrows === undefined ? {} : { arrows }),
    ...(summaries === undefined ? {} : { summaries }),
    direction: normalizeDirection(input.direction),
    meta: { app: META_APP, version: META_VERSION }
  }
  return { data, warnings: [...warnings] }
}

/** 取文档根节点（兼容直接传节点） */
function rootOf(input: unknown): Record<string, unknown> | null {
  if (!isRecord(input)) return null
  if (isRecord(input.nodeData)) return input.nodeData
  if (typeof input.topic === 'string') return input
  return null
}

/** 统计节点总数 */
export function countNodes(input: unknown): number {
  const root = rootOf(input)
  if (root === null) return 0
  let total = 0
  const walk = (node: Record<string, unknown>): void => {
    total += 1
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (isRecord(child)) walk(child)
      }
    }
  }
  walk(root)
  return total
}

/** 统计最大深度（根 = 1） */
export function treeDepth(input: unknown): number {
  const root = rootOf(input)
  if (root === null) return 0
  const walk = (node: Record<string, unknown>): number => {
    if (!Array.isArray(node.children)) return 1
    let max = 0
    for (const child of node.children) {
      if (isRecord(child)) max = Math.max(max, walk(child))
    }
    return max + 1
  }
  return walk(root)
}

/** 收集全部节点 id */
export function collectIds(input: unknown): Set<string> {
  const ids = new Set<string>()
  const root = rootOf(input)
  if (root === null) return ids
  const walk = (node: Record<string, unknown>): void => {
    if (typeof node.id === 'string') ids.add(node.id)
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (isRecord(child)) walk(child)
      }
    }
  }
  walk(root)
  return ids
}

/** 布局方向归一（非法值回退左右布局） */
export function normalizeDirection(value: unknown): MindmapDirection {
  return value === 0 || value === 1 || value === 2 || value === 3 ? value : 2
}

/** 布局方向文案 */
export function directionLabel(code: MindmapDirection): string {
  const labels: Record<MindmapDirection, string> = {
    0: '左侧',
    1: '右侧',
    2: '左右',
    3: '向下'
  }
  return labels[code]
}

/**
 * 生成根节点最小文档（等价 MindElixir.new，但脱离库可测）
 * @param topic 中心主题
 * @param newId id 生成器
 */
export function createDocument(
  topic = '中心主题',
  newId: () => string = defaultNewId
): MindmapDocument {
  return {
    nodeData: {
      id: newId(),
      topic: cleanText(topic, MAX_TOPIC) || '中心主题',
      expanded: true,
      children: []
    },
    direction: 2,
    meta: { app: META_APP, version: META_VERSION }
  }
}

/**
 * 序列化文档（默认 2 空格缩进；先清洗再输出）
 * @param input 文档来源
 * @param options pretty / id 生成器
 */
export function serializeDocument(
  input: unknown,
  options: { pretty?: boolean; newId?: () => string } = {}
): string {
  const { data } = sanitizeDocument(input, options.newId ?? defaultNewId)
  return JSON.stringify(data, null, options.pretty === false ? 0 : 2)
}
