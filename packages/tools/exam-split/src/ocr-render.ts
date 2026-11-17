/**
 * OCR 输入渲染（spec §10.1/§10.4）：PDF/图片 → RGBA 位图；PNG 编码；输入错误分类。
 * 仅 worker 侧使用（依赖 @napi-rs/canvas 原生模块，renderer 不得 import）。
 *
 * spike 实证（2026-11-16，plan §4.4）：
 * - pdfjs-dist 6 legacy build + @napi-rs/canvas：`page.render({ canvas, canvasContext, viewport })`
 * - 中文渲染需注册系统字体（GlobalFonts msyh.ttc）；`standardFontDataUrl`/`cmaps` 用本地路径
 * - pdfjs 加密 → PasswordException（→ PDF_ENCRYPTED）；`doc.cleanup()` 收尾
 */
import { GlobalFonts, ImageData, createCanvas, loadImage } from '@napi-rs/canvas'
import type { Image } from '@napi-rs/canvas'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { tail } from '@lumin/node-kit'
import { errnoCode, type StructuredError } from '@lumin/shared'
import { toolError } from './errors'
import type { RgbaImage } from './ocr-preproc'

/** pdfjs 的 DOM 画布类型（结构兼容别名；工具包不引 DOM lib，主进程 typecheck 才通过） */
type PdfCanvasTarget = Parameters<import('pdfjs-dist').PDFPageProxy['render']>[0]['canvas']
type PdfRenderContext = NonNullable<
  Parameters<import('pdfjs-dist').PDFPageProxy['render']>[0]['canvasContext']
>

/** 渲染倍率（A4 → 1191×1684；坐标归一化后与倍率无关，导出按实际像素换算） */
export const PDF_RENDER_SCALE = 1.5

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
  /** 渲染进度：已渲染页数 / 总页数（detect 侧 render 阶段 progress） */
  onPage?: (done: number, total: number) => void
}

let fontRegistered = false

/** 注册中文渲染字体（幂等；失败不阻断，skia 仍可走系统字体回退） */
export function ensureCjkFont(): void {
  if (fontRegistered) return
  fontRegistered = true
  const windir = process.env.WINDIR ?? 'C:/Windows'
  try {
    GlobalFonts.registerFromPath(`${windir}/Fonts/msyh.ttc`, 'YaHei')
  } catch {
    // 字体缺失（非 Windows 或精简系统）：保留 skia 默认回退，仅中文可能缺字
  }
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

/** pdfjs legacy build（Node/worker 内渲染；裸 specifier 动态 import，构建后由运行时解析） */
async function loadPdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  return import('pdfjs-dist/legacy/build/pdf.mjs')
}

/** pdfjs 资产目录（standard_fonts/cmaps 随包落盘，按本地路径提供） */
function pdfjsRoot(): string {
  const pkg = createRequire(import.meta.url).resolve('pdfjs-dist/package.json')
  return dirname(pkg)
}

async function renderPdf(inputPath: string, options: RenderOptions): Promise<RenderedPage[]> {
  ensureCjkFont()
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(inputPath))
  } catch (err) {
    throw classifyReadError(err, 'pdf')
  }

  const pdfjs = await loadPdfjs()
  const root = pdfjsRoot()
  let doc: import('pdfjs-dist/legacy/build/pdf.mjs').PDFDocumentProxy
  try {
    doc = await pdfjs.getDocument({
      data: bytes,
      standardFontDataUrl: join(root, 'standard_fonts') + '/',
      cMapUrl: join(root, 'cmaps') + '/'
    }).promise
  } catch (err) {
    throw classifyPdfjsError(err)
  }

  try {
    const total = doc.numPages
    options.onPage?.(0, total)
    const wanted = options.pageNumbers ?? Array.from({ length: total }, (_, index) => index + 1)
    const out: RenderedPage[] = []
    for (const pageNumber of wanted) {
      if (pageNumber < 1 || pageNumber > total) {
        throw toolError('INVALID_PAYLOAD', `页码 ${pageNumber} 超出 1..${total}`)
      }
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
      const width = Math.max(1, Math.ceil(viewport.width))
      const height = Math.max(1, Math.ceil(viewport.height))
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      // 页面底色为白（PDF 页面语义即白底；空页/透明区不得落成黑底破坏 OCR 二值假设）
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      try {
        await page.render({
          canvas: canvas as unknown as PdfCanvasTarget,
          canvasContext: ctx as unknown as PdfRenderContext,
          viewport
        }).promise
      } catch (err) {
        throw classifyPdfjsError(err)
      }
      // 软掩模/抗锯齿残留的透明像素补白（destination-over 只填充透明区）
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'source-over'
      out.push({ pageNumber, width, height, image: ctx.getImageData(0, 0, width, height) })
      page.cleanup()
      options.onPage?.(out.length, total)
    }
    return out
  } finally {
    await doc.cleanup()
  }
}

async function renderImage(inputPath: string, options: RenderOptions): Promise<RenderedPage[]> {
  ensureCjkFont()
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
  const width = Math.max(1, Math.floor(source.width))
  const height = Math.max(1, Math.floor(source.height))
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0)
  options.onPage?.(1, 1)
  return [{ pageNumber: 1, width, height, image: ctx.getImageData(0, 0, width, height) }]
}

/**
 * 渲染 OCR 输入（PDF 逐页 / 图片单页，spec §10.1）。
 * 失败抛结构化错误：NOT_FOUND/LOCKED/ENCRYPTED/PDF_INVALID（PDF 类走 §5）、
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
