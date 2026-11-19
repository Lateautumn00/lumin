/**
 * @file render.ts PDF → 画布渲染原语（主进程/worker 侧）
 * @author cuilanchao
 * @date 2026-11-19
 * @description pdfjs-dist legacy + @napi-rs/canvas 的组合封装：注册中文字体、打开 PDF、
 *              逐页渲染为白底 RGBA 画布、编码为 PNG/JPEG 字节。供 exam-split 与
 *              pdf-images 等工具共用；renderer 不得 import（依赖原生模块）。
 */
import { GlobalFonts, createCanvas } from '@napi-rs/canvas'
import type { Canvas } from '@napi-rs/canvas'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** pdfjs 页面代理的最小结构（避免在 node-kit 引入 DOM lib） */
export interface PdfPageHandle {
  /** 页面固有旋转（0/90/180/270） */
  readonly rotate: number
  /** 按倍率取视口尺寸（rotation 为绝对角度，含页面固有旋转） */
  getViewport(params: { scale: number; rotation?: number }): { width: number; height: number }
  /** 渲染到画布（pdfjs 6 需同时给 canvas 与 canvasContext） */
  render(params: { canvas: unknown; canvasContext: unknown; viewport: unknown }): {
    promise: Promise<void>
  }
  /** 释放页面缓存（逐页渲染后调用） */
  cleanup(): void
}

/** pdfjs 文档代理的最小结构 */
export interface PdfDocumentHandle {
  readonly numPages: number
  getPage(pageNumber: number): Promise<PdfPageHandle>
  cleanup(): Promise<void>
}

/** 打开后的 PDF（doc 需调用方最终 `cleanup()`） */
export interface OpenedPdf {
  doc: PdfDocumentHandle
  pageCount: number
}

/** 渲染产物（canvas 由 @napi-rs/canvas 创建，width/height 为像素） */
export interface RenderedCanvas {
  canvas: Canvas
  width: number
  height: number
}

let fontRegistered = false

/**
 * 注册中文渲染字体（幂等；失败不阻断，skia 仍可走系统字体回退）
 */
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

/** pdfjs 资产目录（standard_fonts/cmaps 随依赖落盘，按本地路径提供） */
function pdfjsRoot(): string {
  const pkg = createRequire(import.meta.url).resolve('pdfjs-dist/package.json')
  return dirname(pkg)
}

/** pdfjs legacy build（Node/worker 内渲染；裸 specifier 动态 import，构建后由运行时解析） */
async function loadPdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  return import('pdfjs-dist/legacy/build/pdf.mjs')
}

/**
 * 打开 PDF：接受字节或文件路径（路径由本函数读入，fs 错误原样抛出交由调用方分类）。
 * 加密 PDF 会抛 pdfjs 的 PasswordException（`name === 'PasswordException'`）。
 * @param source PDF 字节或本地文件路径
 */
export async function openPdf(source: Uint8Array | string): Promise<OpenedPdf> {
  // pdfjs 会把 data 的 ArrayBuffer transfer 给内部 worker（原数组随之 detach），
  // 复制一份再传入，避免调用方复用同一份字节时二次 transfer 抛 DataCloneError
  const data =
    typeof source === 'string' ? new Uint8Array(await readFile(source)) : new Uint8Array(source)
  const pdfjs = await loadPdfjs()
  const root = pdfjsRoot()
  const doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl: join(root, 'standard_fonts') + '/',
    cMapUrl: join(root, 'cmaps') + '/'
  }).promise
  return { doc: doc as unknown as PdfDocumentHandle, pageCount: doc.numPages }
}

/**
 * 渲染单页为白底画布（PDF 页面语义即白底；透明区补白避免透明像素）。
 * @param doc 已打开的 PDF
 * @param pageNumber 1-based 页码（越界由 pdfjs 抛错）
 * @param options scale 渲染倍率（DPI/72）；rotation 额外顺时针旋转（叠在页面固有旋转上）
 */
export async function renderPageToCanvas(
  doc: PdfDocumentHandle,
  pageNumber: number,
  options: { scale: number; rotation?: number }
): Promise<RenderedCanvas> {
  ensureCjkFont()
  const page = await doc.getPage(pageNumber)
  const rotation = (page.rotate + (options.rotation ?? 0)) % 360
  const viewport = page.getViewport({ scale: options.scale, rotation })
  const width = Math.max(1, Math.ceil(viewport.width))
  const height = Math.max(1, Math.ceil(viewport.height))
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  // 软掩模/抗锯齿残留的透明像素补白（destination-over 只填充透明区）
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.globalCompositeOperation = 'source-over'
  page.cleanup()
  return { canvas, width, height }
}

/**
 * 画布编码为字节：PNG 无损；JPEG 按质量 0-100（@napi-rs/canvas 异步编码）
 * @param canvas 待编码画布
 * @param format 输出格式
 * @param quality JPEG 质量（PNG 忽略）
 */
export async function encodeCanvas(
  canvas: Canvas,
  format: 'png' | 'jpeg',
  quality = 90
): Promise<Buffer> {
  if (format === 'png') return canvas.toBuffer('image/png')
  return canvas.encode('jpeg', quality)
}
