/**
 * @file ocr-render.ts OCR 输入渲染：PDF/图片 → RGBA 位图；PNG 编码；输入错误分类。
 * @author cuilanchao
 * @date 2026-11-16
 * @description PDF 渲染原语已上提至 @lumin/node-kit/pdf（跨工具共用）；本文件保留
 *              OCR 专属逻辑：RGBA 抽取、旋转、倍率、错误码分类。仅 worker 侧使用
 *              （依赖 @napi-rs/canvas 原生模块，renderer 不得 import）。
 */
import { ImageData, createCanvas, loadImage } from '@napi-rs/canvas'
import type { Image } from '@napi-rs/canvas'
import { readFile } from 'node:fs/promises'
import { openPdf, renderPageToCanvas } from '@lumin/node-kit/pdf'
import { tail } from '@lumin/node-kit'
import { errnoCode, type StructuredError } from '@lumin/shared'
import { toolError } from './errors'
import type { RgbaImage } from './ocr-preproc'
import { PDF_RENDER_SCALE } from './preview'
import type { OcrRotation } from './schema'

/** 渲染倍率单源在 `preview.ts`（renderer 预览换算同源，spec §10.9） */
export { PDF_RENDER_SCALE }
/** 中文字体注册（实现上提至 node-kit/pdf；保持本工具导出名） */
export { ensureCjkFont } from '@lumin/node-kit/pdf'

/** OCR 输入扩展白名单中的 PDF 判断（与 schema.OCR_INPUT_RE 一致；zod 不进 worker 预期） */
const PDF_EXT_RE = /\.pdf$/i

export interface RenderedPage {
  pageNumber: number
  /** 渲染像素宽（= canvas.width，整数；导出换算基准） */
  width: number
  height: number
  image: RgbaImage
}

export interface RenderOptions {
  /** 只渲染指定页（导出按需渲染）；缺省渲染全部页 */
  pageNumbers?: readonly number[]
  /** 顺时针旋转（0/90/180/270，spec §10.12）；detect 与 export 必须同值 */
  rotation?: OcrRotation
  /** 渲染进度：已渲染页数 / 总页数（detect 侧 render 阶段 progress） */
  onPage?: (done: number, total: number) => void
}

/** 旋转后的像素尺寸（90/270 交换宽高；纯函数，覆盖全部分支） */
export function rotatedSize(
  width: number,
  height: number,
  rotation: OcrRotation
): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 读入失败分类（errno → §5 的 NOT_FOUND/LOCKED；其余按输入类型，spec §5/§10.5）。
 * 纯函数（返回结构化错误，调用方 throw），便于覆盖全部分支。
 */
export function classifyReadError(err: unknown, kind: 'pdf' | 'image'): StructuredError {
  const code = errnoCode(err)
  if (code === 'ENOENT') return toolError('PDF_NOT_FOUND', code)
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')
    return toolError('PDF_LOCKED', code)
  const fallback = kind === 'pdf' ? 'PDF_INVALID' : 'OCR_INPUT_INVALID'
  return toolError(fallback, code !== '' ? code : tail(messageOf(err)))
}

/** pdfjs 打开/渲染失败分类（PasswordException → PDF_ENCRYPTED，spec §5）；纯函数同上 */
export function classifyPdfjsError(err: unknown): StructuredError {
  const name = err instanceof Error ? err.name : ''
  const message = tail(messageOf(err))
  if (name === 'PasswordException') return toolError('PDF_ENCRYPTED', message)
  if (name === 'MissingPDFException') return toolError('PDF_NOT_FOUND', message)
  return toolError('PDF_INVALID', message)
}

async function renderPdf(inputPath: string, options: RenderOptions): Promise<RenderedPage[]> {
  let opened: Awaited<ReturnType<typeof openPdf>>
  try {
    opened = await openPdf(inputPath)
  } catch (err) {
    // openPdf 内部读盘失败是 fs 错误（带 errno）；pdfjs 解析失败无 errno
    if (errnoCode(err) !== '') throw classifyReadError(err, 'pdf')
    throw classifyPdfjsError(err)
  }

  try {
    const total = opened.pageCount
    options.onPage?.(0, total)
    const wanted = options.pageNumbers ?? Array.from({ length: total }, (_, index) => index + 1)
    const out: RenderedPage[] = []
    for (const pageNumber of wanted) {
      if (pageNumber < 1 || pageNumber > total) {
        throw toolError('INVALID_PAYLOAD', `页码 ${pageNumber} 超出 1..${total}`)
      }
      let rendered: Awaited<ReturnType<typeof renderPageToCanvas>>
      try {
        rendered = await renderPageToCanvas(opened.doc, pageNumber, {
          scale: PDF_RENDER_SCALE,
          rotation: options.rotation ?? 0
        })
      } catch (err) {
        throw classifyPdfjsError(err)
      }
      const ctx = rendered.canvas.getContext('2d')
      out.push({
        pageNumber,
        width: rendered.width,
        height: rendered.height,
        image: ctx.getImageData(0, 0, rendered.width, rendered.height)
      })
      options.onPage?.(out.length, total)
    }
    return out
  } finally {
    await opened.doc.cleanup()
  }
}

async function renderImage(inputPath: string, options: RenderOptions): Promise<RenderedPage[]> {
  options.onPage?.(0, 1)
  // 先读后解码：IO 错误走 §5 分类，解码失败单独归 OCR_INPUT_INVALID（spec §10.5）
  let bytes: Buffer
  try {
    bytes = await readFile(inputPath)
  } catch (err) {
    throw classifyReadError(err, 'image')
  }
  let source: Image
  try {
    source = await loadImage(bytes)
  } catch (err) {
    throw toolError('OCR_INPUT_INVALID', tail(messageOf(err)))
  }
  const rotation = options.rotation ?? 0
  const naturalWidth = Math.max(1, Math.floor(source.width))
  const naturalHeight = Math.max(1, Math.floor(source.height))
  const { width, height } = rotatedSize(naturalWidth, naturalHeight, rotation)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  if (rotation === 0) {
    ctx.drawImage(source, 0, 0)
  } else {
    // 绕画布中心顺时针旋转（canvas 正角为顺时针，y 轴向下）；源图居中绘制
    ctx.translate(width / 2, height / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.drawImage(source, -naturalWidth / 2, -naturalHeight / 2, naturalWidth, naturalHeight)
  }
  options.onPage?.(1, 1)
  return [{ pageNumber: 1, width, height, image: ctx.getImageData(0, 0, width, height) }]
}

/**
 * 渲染 OCR 输入（PDF 逐页 / 图片单页，spec §10.1）。
 * 失败抛结构化错误：PDF_NOT_FOUND/PDF_LOCKED/PDF_ENCRYPTED/PDF_INVALID（PDF 类走 §5）、
 * OCR_INPUT_INVALID（图片解码）、INVALID_PAYLOAD（页码越界）。
 */
export async function renderOcrInput(
  inputPath: string,
  options: RenderOptions = {}
): Promise<RenderedPage[]> {
  if (PDF_EXT_RE.test(inputPath)) return renderPdf(inputPath, options)
  return renderImage(inputPath, options)
}

/** RGBA → PNG 字节（写后校验头 `89504E47` 由 ocr-ops 执行，spec §10.7） */
export function encodePng(image: RgbaImage): Buffer {
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0)
  return canvas.toBuffer('image/png')
}
