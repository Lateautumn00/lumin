/**
 * @file extract.ts PDF 内容抽取原语（文本层 / 内嵌图片）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 基于 pdfjs legacy 的文本层重建与内嵌图片解码（M38）。仅主进程/worker 使用，
 *              依赖原生模块 @napi-rs/canvas；renderer 不得 import。
 */
import { createHash } from 'node:crypto'
import { ImageData, createCanvas } from '@napi-rs/canvas'
import { loadPdfjs, type PdfDocumentHandle, type PdfPageHandle } from './render'

/** pdfjs 文本项最小结构 */
export interface PdfTextItem {
  str: string
  hasEOL?: boolean
}

/** 单页文本抽取结果 */
export interface ExtractedTextPage {
  pageNumber: number
  text: string
}

/** 文本抽取汇总 */
export interface ExtractedText {
  pages: ExtractedTextPage[]
  hasText: boolean
}

/** pdfjs 原始图像对象最小结构（paintImage* 的参数或 objs 仓库对象） */
export interface PdfRawImage {
  width?: number
  height?: number
  kind?: number
  data?: Uint8Array | Uint8ClampedArray
  bitmap?: { width?: number; height?: number; data?: Uint8ClampedArray }
}

/** 解码后的 RGBA 像素 */
export interface DecodedImage {
  width: number
  height: number
  rgba: Uint8ClampedArray
}

/** 抽取出的单张图片 */
export interface ExtractedImage {
  pageNumber: number
  index: number
  width: number
  height: number
  png: Buffer
}

/** 图片抽取选项 */
export interface ExtractImageOptions {
  /** 宽或高小于该值的图片跳过（默认 16） */
  minSize?: number
  /** 去重后图片数上限（默认 2000） */
  maxImages?: number
}

/** 图片数量超上限（调用方据此映射结构化错误码） */
export class ExtractedImageLimitError extends Error {
  constructor(limit: number) {
    super(`image limit exceeded: ${limit}`)
    this.name = 'ExtractedImageLimitError'
  }
}

const DEFAULT_MIN_SIZE = 16
const DEFAULT_MAX_IMAGES = 2000
const FALLBACK_IMAGE_KIND = { GRAYSCALE_1BPP: 1, RGB_24BPP: 2, RGBA_32BPP: 3 } as const
const FALLBACK_PAINT_IMAGE = { xObject: 85, inline: 86 } as const

/** pdfjs 导出的常量（取不到时用内置值兜底，版本升级不致中断） */
interface PdfjsConstants {
  gray: number
  rgb: number
  rgba: number
  paintXObject: number
  paintInline: number
}

async function loadConstants(): Promise<PdfjsConstants> {
  const pdfjs = (await loadPdfjs()) as unknown as {
    ImageKind?: Record<string, number>
    OPS?: Record<string, number>
  }
  return {
    gray: pdfjs.ImageKind?.GRAYSCALE_1BPP ?? FALLBACK_IMAGE_KIND.GRAYSCALE_1BPP,
    rgb: pdfjs.ImageKind?.RGB_24BPP ?? FALLBACK_IMAGE_KIND.RGB_24BPP,
    rgba: pdfjs.ImageKind?.RGBA_32BPP ?? FALLBACK_IMAGE_KIND.RGBA_32BPP,
    paintXObject: pdfjs.OPS?.paintImageXObject ?? FALLBACK_PAINT_IMAGE.xObject,
    paintInline: pdfjs.OPS?.paintInlineImageXObject ?? FALLBACK_PAINT_IMAGE.inline
  }
}

/** 文本项过滤（pdfjs items 含标记项，仅保留 str） */
export function toTextItems(items: readonly unknown[]): PdfTextItem[] {
  const result: PdfTextItem[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as { str?: unknown; hasEOL?: unknown }
    if (typeof record.str !== 'string') continue
    result.push({ str: record.str, hasEOL: record.hasEOL === true })
  }
  return result
}

/**
 * 按 items 顺序重建一页文本：`hasEOL` 处换行，裁行尾空白，去页首/页尾空行。
 * @param items 已过滤的文本项
 */
export function buildPageText(items: readonly PdfTextItem[]): string {
  let raw = ''
  for (const item of items) {
    raw += item.str
    if (item.hasEOL === true) raw += '\n'
  }
  return raw
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}

/** 逐页抽取文本（单页失败记空串，不中断） */
export async function extractPdfText(
  doc: PdfDocumentHandle,
  pageNumbers: readonly number[]
): Promise<ExtractedText> {
  const pages: ExtractedTextPage[] = []
  let hasText = false
  for (const pageNumber of pageNumbers) {
    let text = ''
    try {
      const page = await doc.getPage(pageNumber)
      if (page.getTextContent !== undefined) {
        const content = await page.getTextContent()
        text = buildPageText(toTextItems(content.items))
      }
      page.cleanup()
    } catch {
      text = ''
    }
    if (text.trim() !== '') hasText = true
    pages.push({ pageNumber, text })
  }
  return { pages, hasText }
}

/**
 * 原始图像 → RGBA 像素（GRAYSCALE_1BPP 按行解包，1=白、0=黑；RGB 补 α；RGBA 直用）。
 * 数据缺失或长度不足返回 null（调用方跳过该图）。
 */
export function decodeRawImage(raw: PdfRawImage): DecodedImage | null {
  const width = raw.width ?? raw.bitmap?.width
  const height = raw.height ?? raw.bitmap?.height
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null
  }
  const pixels = width * height

  const bitmapData = raw.bitmap?.data
  if (bitmapData instanceof Uint8ClampedArray && bitmapData.length >= pixels * 4) {
    return { width, height, rgba: bitmapData.slice(0, pixels * 4) }
  }

  const data = raw.data
  if (!(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray)) return null
  const kind = raw.kind

  if (kind === FALLBACK_IMAGE_KIND.RGBA_32BPP) {
    if (data.length < pixels * 4) return null
    return { width, height, rgba: new Uint8ClampedArray(data.subarray(0, pixels * 4)) }
  }

  if (kind === FALLBACK_IMAGE_KIND.RGB_24BPP) {
    if (data.length < pixels * 3) return null
    const rgba = new Uint8ClampedArray(pixels * 4)
    for (let index = 0; index < pixels; index += 1) {
      const source = index * 3
      const target = index * 4
      rgba[target] = data[source] as number
      rgba[target + 1] = data[source + 1] as number
      rgba[target + 2] = data[source + 2] as number
      rgba[target + 3] = 255
    }
    return { width, height, rgba }
  }

  if (kind === FALLBACK_IMAGE_KIND.GRAYSCALE_1BPP) {
    const rowBytes = Math.ceil(width / 8)
    if (data.length < rowBytes * height) return null
    const rgba = new Uint8ClampedArray(pixels * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const byte = data[y * rowBytes + (x >> 3)] as number
        const value = ((byte >> (7 - (x & 7))) & 1) === 1 ? 255 : 0
        const target = (y * width + x) * 4
        rgba[target] = value
        rgba[target + 1] = value
        rgba[target + 2] = value
        rgba[target + 3] = 255
      }
    }
    return { width, height, rgba }
  }

  return null
}

/** RGBA → PNG 字节 */
function encodePng(decoded: DecodedImage): Buffer {
  const canvas = createCanvas(decoded.width, decoded.height)
  const ctx = canvas.getContext('2d')
  ctx.putImageData(new ImageData(decoded.rgba, decoded.width, decoded.height), 0, 0)
  return canvas.toBuffer('image/png')
}

/**
 * 抽取页面内嵌图片：跳过小于 minSize 的图、按像素内容 sha256 去重、超上限抛
 * `ExtractedImageLimitError`；单张解码失败跳过不中断。
 */
export async function extractPdfImages(
  doc: PdfDocumentHandle,
  pageNumbers: readonly number[],
  options: ExtractImageOptions = {}
): Promise<{ images: ExtractedImage[]; skipped: number }> {
  const minSize = options.minSize ?? DEFAULT_MIN_SIZE
  const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES
  const constants = await loadConstants()
  const images: ExtractedImage[] = []
  const seen = new Set<string>()
  let skipped = 0

  for (const pageNumber of pageNumbers) {
    let page: PdfPageHandle
    try {
      page = await doc.getPage(pageNumber)
    } catch {
      skipped += 1
      continue
    }
    if (page.getOperatorList === undefined) {
      page.cleanup()
      continue
    }
    let rawImages: PdfRawImage[] = []
    try {
      const list = await page.getOperatorList()
      rawImages = collectFromOperatorList(list, page.objs, constants)
    } catch {
      skipped += 1
    }
    let index = 0
    for (const raw of rawImages) {
      const decoded = decodeRawImage(raw)
      if (decoded === null || decoded.width < minSize || decoded.height < minSize) {
        skipped += 1
        continue
      }
      const digest = createHash('sha256').update(decoded.rgba).digest('hex')
      if (seen.has(digest)) continue
      seen.add(digest)
      if (images.length >= maxImages) {
        page.cleanup()
        throw new ExtractedImageLimitError(maxImages)
      }
      index += 1
      images.push({
        pageNumber,
        index,
        width: decoded.width,
        height: decoded.height,
        png: encodePng(decoded)
      })
    }
    page.cleanup()
  }

  return { images, skipped }
}

/** 从操作符列表提取 paintImage* 的原始图像（objId 走 page.objs） */
function collectFromOperatorList(
  list: { fnArray: readonly number[]; argsArray: readonly unknown[][] },
  objs: { get(id: string): unknown } | undefined,
  constants: PdfjsConstants
): PdfRawImage[] {
  const result: PdfRawImage[] = []
  for (const [offset, fn] of list.fnArray.entries()) {
    const args = list.argsArray[offset] ?? []
    if (fn === constants.paintXObject) {
      const objId = args[0]
      if (typeof objId !== 'string' || objs === undefined) continue
      let raw: unknown
      try {
        raw = objs.get(objId)
      } catch {
        continue
      }
      if (isRawImage(raw)) result.push(raw)
      continue
    }
    if (fn === constants.paintInline) {
      const raw = args[0]
      if (isRawImage(raw)) result.push(raw)
    }
  }
  return result
}

/** 结构化收窄为 PdfRawImage（仅检查 width/height 存在） */
function isRawImage(value: unknown): value is PdfRawImage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { width?: unknown; height?: unknown; data?: unknown; bitmap?: unknown }
  if (typeof record.width !== 'number' && typeof record.bitmap !== 'object') return false
  return typeof record.data === 'object' || typeof record.bitmap === 'object'
}
