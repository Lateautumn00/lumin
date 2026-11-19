/**
 * @file contract.ts 纯函数契约（命名/像素换算/页面布局）
 * @author cuilanchao
 * @date 2026-11-19
 * @description PDF→图片的文件名模板、DPI→pdfjs 缩放倍率；图片→PDF 的 A4 等比居中
 *              布局与合并命名。全部无副作用，供 node/worker/renderer 共用，单测全覆盖。
 */
import { baseName } from '@lumin/shared'
import type { Dpi, OutputImageFormat, PdfImagesFailure } from './schema'

/** 1 英寸 = 72pt（PDF 用户单位） */
const PT_PER_INCH = 72

/** 毫米 → PDF 点 */
const PT_PER_MM = PT_PER_INCH / 25.4

/** A4 尺寸（pt，595.28 × 841.89） */
export const A4_WIDTH_PT = 210 * PT_PER_MM
export const A4_HEIGHT_PT = 297 * PT_PER_MM

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

/** A4 单页布局（pt） */
export interface A4Layout {
  pageWidth: number
  pageHeight: number
  /** 图片绘制原点与尺寸（居中） */
  x: number
  y: number
  width: number
  height: number
}

/**
 * A4 等比 contain 布局：可用区 = A4 减两倍边距，图片等比缩放后居中。
 * 可用区不足（边距过大）返回 null。
 * @param imageWidth 图片像素宽
 * @param imageHeight 图片像素高
 * @param marginMm 页边距（mm）
 */
export function a4Layout(
  imageWidth: number,
  imageHeight: number,
  marginMm: number
): A4Layout | null {
  if (imageWidth <= 0 || imageHeight <= 0) return null
  const margin = mmToPt(marginMm)
  const contentWidth = A4_WIDTH_PT - margin * 2
  const contentHeight = A4_HEIGHT_PT - margin * 2
  if (contentWidth <= 0 || contentHeight <= 0) return null
  const scale = Math.min(contentWidth / imageWidth, contentHeight / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  return {
    pageWidth: A4_WIDTH_PT,
    pageHeight: A4_HEIGHT_PT,
    x: (A4_WIDTH_PT - width) / 2,
    y: (A4_HEIGHT_PT - height) / 2,
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
