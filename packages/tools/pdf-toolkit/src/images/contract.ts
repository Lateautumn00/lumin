/**
 * @file contract.ts 纯函数契约（命名/像素换算/页面布局）
 * @author cuilanchao
 * @date 2026-11-19
 * @description PDF→图片的文件名模板、DPI→pdfjs 缩放倍率；图片→PDF 的 A4 等比居中
 *              布局与合并命名。全部无副作用，供 node/worker/renderer 共用，单测全覆盖。
 */
import { baseName } from '@lumin/shared'
import type {
  Dpi,
  OutputImageFormat,
  PageOrientation,
  PageSizeMode,
  PdfImagesFailure
} from './schema'

/** 1 英寸 = 72pt（PDF 用户单位） */
const PT_PER_INCH = 72

/** 毫米 → PDF 点 */
const PT_PER_MM = PT_PER_INCH / 25.4

/** A4 尺寸（pt，595.28 × 841.89） */
export const A4_WIDTH_PT = 210 * PT_PER_MM
export const A4_HEIGHT_PT = 297 * PT_PER_MM

/** Letter 尺寸（pt，8.5 × 11 英寸 = 612 × 792） */
export const LETTER_WIDTH_PT = 612
export const LETTER_HEIGHT_PT = 792

/**
 * DPI → pdfjs 渲染缩放倍率（pdfjs 基准 72dpi）
 * @param dpi 目标分辨率
 */
export function dpiToScale(dpi: Dpi): number {
  return dpi / PT_PER_INCH
}

/**
 * 毫米 → PDF 点
 * @param mm 毫米值
 */
export function mmToPt(mm: number): number {
  return mm * PT_PER_MM
}

/**
 * PDF 页导出的图片文件名：`{基名}_p{页码}.{png|jpg}`
 * @param inputPath 源 PDF 路径
 * @param pageNumber 1-based 页码
 * @param format 输出格式（jpeg 落盘为 .jpg）
 */
export function outputImageName(
  inputPath: string,
  pageNumber: number,
  format: OutputImageFormat
): string {
  const ext = format === 'jpeg' ? 'jpg' : 'png'
  return `${baseName(inputPath)}_p${pageNumber}.${ext}`
}

/**
 * 图片扩展名归一：png/jpg 可直嵌，其余（webp/bmp/tiff/avif/gif）走 ffmpeg 转码
 * @param pathOrName 文件路径或文件名
 */
export function imageKind(pathOrName: string): 'png' | 'jpeg' | 'other' {
  const dot = pathOrName.lastIndexOf('.')
  const ext = dot < 0 ? '' : pathOrName.slice(dot + 1).toLowerCase()
  if (ext === 'png') return 'png'
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg'
  return 'other'
}

/** 固定纸型页面方向（auto 已解析为实际方向） */
export type ResolvedOrientation = 'portrait' | 'landscape'

/** 单页布局输入（auto 模式忽略 orientation 与 marginMm） */
export interface PageLayoutOptions {
  pageSize: PageSizeMode
  orientation: PageOrientation
  marginMm: number
}

/** 单页布局（pt） */
export interface PageLayout {
  pageWidth: number
  pageHeight: number
  /** 图片绘制原点与尺寸（居中） */
  x: number
  y: number
  width: number
  height: number
}

/**
 * 固定纸型的长短边（pt）
 * @param pageSize a4 / letter
 */
function paperSize(pageSize: 'a4' | 'letter'): { width: number; height: number } {
  return pageSize === 'a4'
    ? { width: A4_WIDTH_PT, height: A4_HEIGHT_PT }
    : { width: LETTER_WIDTH_PT, height: LETTER_HEIGHT_PT }
}

/**
 * 解析页面方向：auto 跟随图片宽高（正方形按竖版）
 * @param orientation 用户选择
 * @param imageWidth 图片像素宽
 * @param imageHeight 图片像素高
 */
export function resolveOrientation(
  orientation: PageOrientation,
  imageWidth: number,
  imageHeight: number
): ResolvedOrientation {
  if (orientation !== 'auto') return orientation
  return imageHeight >= imageWidth ? 'portrait' : 'landscape'
}

/**
 * 单页布局：auto 页 = 图片尺寸；a4/letter 按方向取纸型长短边，
 * 可用区 = 纸型减两倍边距，图片等比 contain 居中。可用区不足返回 null。
 * @param imageWidth 图片像素宽
 * @param imageHeight 图片像素高
 * @param options 纸型/方向/边距
 */
export function pageLayout(
  imageWidth: number,
  imageHeight: number,
  options: PageLayoutOptions
): PageLayout | null {
  if (imageWidth <= 0 || imageHeight <= 0) return null
  if (options.pageSize === 'auto') {
    return {
      pageWidth: imageWidth,
      pageHeight: imageHeight,
      x: 0,
      y: 0,
      width: imageWidth,
      height: imageHeight
    }
  }

  const paper = paperSize(options.pageSize)
  const orientation = resolveOrientation(options.orientation, imageWidth, imageHeight)
  const pageWidth = orientation === 'portrait' ? paper.width : paper.height
  const pageHeight = orientation === 'portrait' ? paper.height : paper.width
  const margin = mmToPt(options.marginMm)
  const contentWidth = pageWidth - margin * 2
  const contentHeight = pageHeight - margin * 2
  if (contentWidth <= 0 || contentHeight <= 0) return null

  const scale = Math.min(contentWidth / imageWidth, contentHeight / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height
  }
}

/**
 * 图片合并 PDF 的输出文件名：`{首图基名}_合并.pdf`
 * @param firstInputPath 第一张图片路径
 */
export function mergedPdfName(firstInputPath: string): string {
  return `${baseName(firstInputPath)}_合并.pdf`
}

/**
 * 图片合并 PDF 的最终文件名：自定义名优先（去尾部 `.pdf` 后补 `.pdf`），留空回退默认模板
 * @param firstInputPath 第一张图片路径
 * @param outputName 用户输入的文件名（可含 `.pdf`）
 */
export function pdfOutputName(firstInputPath: string, outputName?: string): string {
  const trimmed = outputName?.trim() ?? ''
  if (trimmed === '') return mergedPdfName(firstInputPath)
  const base = trimmed.replace(/\.pdf$/i, '')
  return `${base}.pdf`
}

/**
 * 数组内移动元素（上移/下移），越界原样返回副本
 * @param items 原数组（不修改）
 * @param from 源下标
 * @param to 目标下标
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items]
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next
  const [moved] = next.splice(from, 1)
  if (moved !== undefined) next.splice(to, 0, moved)
  return next
}

/**
 * 结构化错误 → 失败项投影（worker 汇总用）
 * @param file 失败文件名/路径
 * @param err 结构化错误
 */
export function toFailure(
  file: string,
  err: { code: string; message: string; detail?: string }
): PdfImagesFailure {
  return err.detail === undefined || err.detail === ''
    ? { file, code: err.code, message: err.message }
    : { file, code: err.code, message: err.message, detail: err.detail }
}
