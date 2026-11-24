/**
 * @file 图片导出纯函数与栅格化
 * @author cuilanchao
 * @date 2026-11-24
 * @description computeExportBox / buildSvgDocument / buildRasterSvg / rasterizePng；零新增依赖。
 *              SVG 文件用 foreignObject 保留完整 DOM 外观；PNG 走纯原生 SVG（矩形 + 文本 + 分支
 *              线路径），避免 Chromium 对 foreignObject 画布 taint 导致 toBlob 失败（spec §4.4）。
 */
import { toolError } from '../errors'

/** 矩形（画布坐标系） */
export interface BoxRect {
  x: number
  y: number
  width: number
  height: number
}

/** 导出视口 */
export interface ExportBox {
  x: number
  y: number
  width: number
  height: number
}

/** 最小导出尺寸 */
export const MIN_EXPORT_WIDTH = 320
export const MIN_EXPORT_HEIGHT = 200
/** 单边像素上限 */
export const MAX_EXPORT_SIDE = 8192
/** 总像素上限 */
export const MAX_EXPORT_PIXELS = 32 * 1024 * 1024

/**
 * 节点包围盒并集 + 内边距（忽略当前缩放/平移，最小 320×200）
 * @param rects 节点矩形列表
 * @param padding 内边距
 */
export function computeExportBox(rects: readonly BoxRect[], padding = 32): ExportBox {
  if (rects.length === 0) {
    return { x: 0, y: 0, width: MIN_EXPORT_WIDTH, height: MIN_EXPORT_HEIGHT }
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(MIN_EXPORT_WIDTH, Math.ceil(maxX - minX) + padding * 2),
    height: Math.max(MIN_EXPORT_HEIGHT, Math.ceil(maxY - minY) + padding * 2)
  }
}

/**
 * 校验并计算导出像素尺寸
 * @param width 未缩放宽
 * @param height 未缩放宽高
 * @param scale 倍率
 */
export function resolveExportSize(
  width: number,
  height: number,
  scale: number
): { width: number; height: number } {
  const factor = Math.min(3, Math.max(1, Math.round(scale)))
  const pixelWidth = Math.round(width * factor)
  const pixelHeight = Math.round(height * factor)
  if (
    pixelWidth > MAX_EXPORT_SIDE ||
    pixelHeight > MAX_EXPORT_SIDE ||
    pixelWidth * pixelHeight > MAX_EXPORT_PIXELS
  ) {
    throw toolError('MM_EXPORT_TOO_LARGE', `${pixelWidth}×${pixelHeight}`)
  }
  return { width: pixelWidth, height: pixelHeight }
}

/** SVG 文档参数 */
export interface SvgDocumentOptions {
  width: number
  height: number
  background: string | null
  css: string
  body: string
  scale?: number
}

/**
 * 构造 SVG 文档（根节点尺寸 = 画布 × 倍率，viewBox 保持未缩放）
 * @param options 宽高 / 背景 / 样式 / 节点快照
 */
export function buildSvgDocument(options: SvgDocumentOptions): string {
  const scale = options.scale === undefined ? 1 : Math.min(3, Math.max(1, options.scale))
  const outputWidth = Math.round(options.width * scale)
  const outputHeight = Math.round(options.height * scale)
  const background =
    options.background === null
      ? ''
      : `<rect x="0" y="0" width="${options.width}" height="${options.height}" fill="${options.background}" />`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${options.width} ${options.height}">`,
    `<style>${options.css}</style>`,
    background,
    `<foreignObject x="0" y="0" width="${options.width}" height="${options.height}">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${options.width}px;height:${options.height}px">`,
    options.body,
    '</div></foreignObject></svg>'
  ].join('')
}

/** 栅格化节点（画布坐标系相对导出视口左上角） */
export interface RasterNode {
  x: number
  y: number
  width: number
  height: number
  text: string
  fill: string
  color: string
  stroke: string
  strokeWidth: number
  radius: number
  fontSize: number
  fontWeight: string
}

/** 原生 SVG（可安全栅格化）参数 */
export interface RasterSvgOptions {
  width: number
  height: number
  background: string | null
  /** 分支线标记（已按导出视口平移的 SVG 片段） */
  lines: string
  nodes: readonly RasterNode[]
  scale?: number
}

/** XML 文本 / 属性转义 */
export function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 输出数字（保留两位小数，非有限值归零） */
function num(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(Math.round(value * 100) / 100)
}

/** 单字符估算宽度（CJK 按 1em，ASCII 按 0.55em） */
function charWidth(char: string, fontSize: number): number {
  const code = char.codePointAt(0) ?? 0
  if (code > 0x2e80) return fontSize
  if (char === ' ') return fontSize * 0.3
  return fontSize * 0.55
}

/**
 * 按节点宽度折行（无依赖估算，保留显式换行）
 * @param text 节点文本
 * @param fontSize 字号
 * @param maxWidth 可用宽度
 */
export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const size = fontSize > 0 ? fontSize : 14
  const limit = maxWidth > size ? maxWidth : size
  const result: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let line = ''
    let used = 0
    for (const char of Array.from(paragraph)) {
      const width = charWidth(char, size)
      if (line !== '' && used + width > limit) {
        result.push(line)
        line = ''
        used = 0
      }
      line += char
      used += width
    }
    result.push(line)
  }
  return result.length === 0 ? [''] : result
}

/** 单个节点 → 矩形 + 居中文本 */
function renderRasterNode(node: RasterNode): string {
  const radius = node.radius > 0 ? ` rx="${num(node.radius)}" ry="${num(node.radius)}"` : ''
  const stroke =
    node.strokeWidth > 0
      ? ` stroke="${escapeXmlText(node.stroke)}" stroke-width="${num(node.strokeWidth)}"`
      : ''
  const fontSize = node.fontSize > 0 ? node.fontSize : 14
  const lines = wrapText(node.text, fontSize, node.width - fontSize)
  const lineHeight = Math.round(fontSize * 1.35)
  const centerX = node.x + node.width / 2
  const startY = node.y + node.height / 2 - ((lines.length - 1) * lineHeight) / 2
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="${num(centerX)}" y="${num(startY + index * lineHeight)}">${escapeXmlText(line)}</tspan>`
    )
    .join('')
  return [
    `<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}"${radius} fill="${escapeXmlText(node.fill)}"${stroke} />`,
    `<text text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="${num(fontSize)}" font-weight="${escapeXmlText(node.fontWeight)}" fill="${escapeXmlText(node.color)}">${tspans}</text>`
  ].join('')
}

/**
 * 构造可安全栅格化的原生 SVG（不含 foreignObject，画布不会被 taint）
 * @param options 宽高 / 背景 / 分支线 / 节点
 */
export function buildRasterSvg(options: RasterSvgOptions): string {
  const scale = options.scale === undefined ? 1 : Math.min(3, Math.max(1, options.scale))
  const outputWidth = Math.round(options.width * scale)
  const outputHeight = Math.round(options.height * scale)
  const background =
    options.background === null
      ? ''
      : `<rect x="0" y="0" width="${num(options.width)}" height="${num(options.height)}" fill="${escapeXmlText(options.background)}" />`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(outputWidth)}" height="${num(outputHeight)}" viewBox="0 0 ${num(options.width)} ${num(options.height)}">`,
    background,
    options.lines,
    ...options.nodes.map(renderRasterNode),
    '</svg>'
  ].join('')
}

/** 元素相对祖先的布局偏移（不受 transform 缩放/平移影响） */
function offsetWithin(
  element: HTMLElement,
  ancestor: HTMLElement
): { x: number; y: number; reached: boolean } {
  let x = 0
  let y = 0
  let current: HTMLElement | null = element
  while (current !== null && current !== ancestor) {
    x += current.offsetLeft
    y += current.offsetTop
    const parent: Element | null = current.offsetParent
    current = parent instanceof HTMLElement ? parent : null
  }
  return { x, y, reached: current === ancestor }
}

/**
 * 从舞台收集节点矩形（优先布局偏移；偏移链断裂时回退视口坐标 / 缩放）
 * @param container 画布挂载点
 * @param scale 当前缩放倍率（1 = 100%）
 */
export function collectStageRects(container: HTMLElement, scale: number): BoxRect[] {
  const canvas = container.querySelector('.map-canvas')
  if (!(canvas instanceof HTMLElement)) return []
  const factor = scale > 0 ? scale : 1
  const base = canvas.getBoundingClientRect()
  return Array.from(container.querySelectorAll('.me-tpc')).map((element) => {
    const topic = element as HTMLElement
    const offset = offsetWithin(topic, canvas)
    if (offset.reached) {
      return { x: offset.x, y: offset.y, width: topic.offsetWidth, height: topic.offsetHeight }
    }
    const rect = topic.getBoundingClientRect()
    return {
      x: (rect.left - base.left) / factor,
      y: (rect.top - base.top) / factor,
      width: rect.width / factor,
      height: rect.height / factor
    }
  })
}

/** 取消哨兵 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw toolError('MM_EXPORT_FAILED', '已取消')
}

/** 载入 SVG Blob 为 Image（支持取消） */
function loadImage(url: string, signal: AbortSignal | undefined): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const onAbort = (): void => {
      reject(toolError('MM_EXPORT_FAILED', '已取消'))
    }
    image.onload = () => {
      signal?.removeEventListener('abort', onAbort)
      resolve(image)
    }
    image.onerror = () => {
      signal?.removeEventListener('abort', onAbort)
      reject(toolError('MM_EXPORT_FAILED', 'SVG 渲染失败'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    image.src = url
  })
}

/** Canvas → PNG Blob */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(toolError('MM_EXPORT_FAILED', 'PNG 编码失败'))
      else resolve(blob)
    }, 'image/png')
  })
}

/**
 * SVG → PNG（Canvas 栅格化）
 * @param svg SVG 文档字符串
 * @param pixelWidth 输出宽
 * @param pixelHeight 输出高
 * @param signal 取消信号
 */
export async function rasterizePng(
  svg: string,
  pixelWidth: number,
  pixelHeight: number,
  signal?: AbortSignal
): Promise<Blob> {
  throwIfAborted(signal)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await loadImage(url, signal)
    throwIfAborted(signal)
    const canvas = document.createElement('canvas')
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    const context = canvas.getContext('2d')
    if (context === null) throw toolError('MM_EXPORT_FAILED', 'Canvas 不可用')
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight)
    const blob = await canvasToBlob(canvas)
    throwIfAborted(signal)
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Blob → base64（不含 data URL 前缀）
 * @param blob 二进制内容
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(toolError('MM_EXPORT_FAILED', '读取导出结果失败'))
    reader.readAsDataURL(blob)
  })
}
