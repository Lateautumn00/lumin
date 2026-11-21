/**
 * @file naming.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description 各操作的期望输出文件名（冲突递增由 pdf-ops 调 node-kit.resolveConflictPath）
 */
import { baseName, rangeLabel, toRangeList } from '@lumin/shared'

/** 区间组标签（组内连续，取首尾） */
function groupLabel(pages: readonly number[]): string {
  const first = pages[0]
  const last = pages[pages.length - 1]
  if (first === undefined || last === undefined) return ''
  return rangeLabel({ start: first, end: last })
}

/** 合并：`{首个基名}_合并.pdf` */
export function mergeDesiredPath(inputPaths: readonly string[]): string {
  const first = inputPaths[0]
  if (first === undefined) return '_合并.pdf'
  return `${baseName(first)}_合并.pdf`
}

/** 拆分：`{基名}_p{区间标签}.pdf`，每区间一个产物 */
export function splitDesiredPaths(inputPath: string, groups: readonly number[][]): string[] {
  const base = baseName(inputPath)
  return groups.map((pages) => `${base}_p${groupLabel(pages)}.pdf`)
}

/** 删页：`{基名}_删p{标签}.pdf`（多段以逗号连接） */
export function deleteDesiredPath(inputPath: string, pages: readonly number[]): string {
  const label = toRangeList(pages).map(rangeLabel).join(',')
  return `${baseName(inputPath)}_删p${label}.pdf`
}

/** 旋转：`{基名}_旋转{degrees}.pdf` */
export function rotateDesiredPath(inputPath: string, degrees: number): string {
  return `${baseName(inputPath)}_旋转${degrees}.pdf`
}

/** 重排：`{基名}_重排.pdf` */
export function reorderDesiredPath(inputPath: string): string {
  return `${baseName(inputPath)}_重排.pdf`
}

/** 元数据：`{基名}_元数据.pdf` */
export function metadataDesiredPath(inputPath: string): string {
  return `${baseName(inputPath)}_元数据.pdf`
}

/** 水印：`{基名}_水印.pdf` */
export function watermarkDesiredPath(inputPath: string): string {
  return `${baseName(inputPath)}_水印.pdf`
}

/** 页码：`{基名}_页码.pdf` */
export function pageNumbersDesiredPath(inputPath: string): string {
  return `${baseName(inputPath)}_页码.pdf`
}

/** 文本提取：`{基名}_文本.txt`（M38） */
export function extractTextDesiredPath(inputPath: string): string {
  return `${baseName(inputPath)}_文本.txt`
}

/** 图片提取：`{基名}_图片` 目录（M38） */
export function extractImagesDesiredDir(inputPath: string): string {
  return `${baseName(inputPath)}_图片`
}

/** 压缩：`{基名}_压缩.pdf`（M38） */
export function compressDesiredPath(inputPath: string): string {
  return `${baseName(inputPath)}_压缩.pdf`
}
