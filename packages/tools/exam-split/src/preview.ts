/** 预览页码区间（1-based 闭区间；可多段高亮） */
export interface PdfRange {
  start: number
  end: number
}

/** 裁剪框（0–1 比例，左上原点；与 `cropBoxSchema` 同形状，spec §1） */
export interface CropBox {
  x: number
  y: number
  width: number
  height: number
}

/** 裁剪框数值（mm，左上原点；UI 输入项，spec §1/§2） */
export interface MmBox {
  x: number
  y: number
  width: number
  height: number
}

/** 页面尺寸（PDF 点：1pt = 1/72 inch；预览当前页 MediaBox 尺寸） */
export interface PageSize {
  width: number
  height: number
}

/** 1pt → mm */
export const MM_PER_PT = 25.4 / 72

/** 区间数组 → 规范化区间文本（点选回写文本框；spec §2 双向同步） */
export function rangesToText(ranges: readonly PdfRange[]): string {
  return ranges
    .map((range) => (range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`))
    .join(',')
}

/**
 * 区间文本 → 区间数组（文本框失焦回写高亮；spec §2）。
 * 语义与主进程 `ranges.ts` 一致：按逗号分段、段内 trim、空段跳过、段内不接受空格。
 * 语法错/逆序/零页码/无有效段返回 `null`（调用方保留原文并标红）；空串返回 `[]`。
 * 越界（>页数）不在本函数校验（初校在 ToolView 按页数比对，终校在主进程）。
 */
export function parseRangeText(text: string): PdfRange[] | null {
  const trimmed = text.trim()
  if (trimmed === '') return []
  if (!/^[\d\s,-]+$/.test(trimmed)) return null
  const ranges: PdfRange[] = []
  for (const part of trimmed.split(',')) {
    const token = part.trim()
    if (token === '') continue
    const match = /^(\d+)(?:-(\d+))?$/.exec(token)
    if (match === null) return null
    const start = Number(match[1])
    const end = match[2] === undefined ? start : Number(match[2])
    if (start < 1 || end < start) return null
    ranges.push({ start, end })
  }
  return ranges.length === 0 ? null : ranges
}

/** mm 输入值（当前预览页参照）→ 0–1 比例框；越出参照页时钳到页边，不可用返回 null */
export function mmToRatio(box: MmBox, page: PageSize): CropBox | null {
  if (page.width <= 0 || page.height <= 0) return null
  const x = box.x / MM_PER_PT
  const y = box.y / MM_PER_PT
  const width = box.width / MM_PER_PT
  const height = box.height / MM_PER_PT
  if (!(width > 0) || !(height > 0)) return null
  if (x >= page.width || y >= page.height) return null
  const clampedWidth = Math.min(width, page.width - x)
  const clampedHeight = Math.min(height, page.height - y)
  return {
    x: x / page.width,
    y: y / page.height,
    width: clampedWidth / page.width,
    height: clampedHeight / page.height
  }
}

/** 0–1 比例框 → mm 数值（回显到 4 个输入框；spec §2 实时回显） */
export function ratioToMm(box: CropBox, page: PageSize): MmBox {
  return {
    x: box.x * page.width * MM_PER_PT,
    y: box.y * page.height * MM_PER_PT,
    width: box.width * page.width * MM_PER_PT,
    height: box.height * page.height * MM_PER_PT
  }
}

/** 整页比例框（裁剪默认值；spec §3.2 默认整页） */
export const FULL_PAGE_BOX: CropBox = { x: 0, y: 0, width: 1, height: 1 }
