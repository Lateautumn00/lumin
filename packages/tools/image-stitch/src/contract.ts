/**
 * @file contract.ts 纯函数契约（拼接布局/命名/扩展名）
 * @author cuilanchao
 * @date 2026-11-20
 * @description `planLayout` 为布局单一真相源：纵向统一宽、横向统一高、网格等宽单元格 contain 居中；
 *              renderer 预览与 worker 出图共用（spec §4）。
 */
import type { ImageEncoder, LayoutOptions, SizeMode } from './schema'

/** 输出画布单边上限（px） */
export const MAX_CANVAS_EDGE = 30_000

/** 输出画布总像素上限 */
export const MAX_CANVAS_PIXELS = 100_000_000

/** 尺寸 */
export interface Size {
  width: number
  height: number
}

/** 单张图片在画布中的落位 */
export interface Placement extends Size {
  x: number
  y: number
}

/** 布局结果 */
export interface LayoutPlan {
  width: number
  height: number
  placements: Placement[]
}

/**
 * 数值夹取并取整（NaN/Infinity 归下界）
 * @param value 原始值
 * @param min 下界
 * @param max 上界
 */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * 等比缩放到目标宽
 * @param width 原始宽
 * @param height 原始高
 * @param targetWidth 目标宽
 * @returns 缩放尺寸；入参非法返回 null
 */
export function scaleToWidth(width: number, height: number, targetWidth: number): Size | null {
  if (width <= 0 || height <= 0 || targetWidth <= 0) return null
  return { width: targetWidth, height: Math.max(1, Math.round((height / width) * targetWidth)) }
}

/**
 * 等比缩放到目标高
 * @param width 原始宽
 * @param height 原始高
 * @param targetHeight 目标高
 * @returns 缩放尺寸；入参非法返回 null
 */
export function scaleToHeight(width: number, height: number, targetHeight: number): Size | null {
  if (width <= 0 || height <= 0 || targetHeight <= 0) return null
  return { width: Math.max(1, Math.round((width / height) * targetHeight)), height: targetHeight }
}

/**
 * contain 缩放（完整放入盒子，取较小比例，不放大）
 * @param width 原始宽
 * @param height 原始高
 * @param boxWidth 盒子宽
 * @param boxHeight 盒子高
 * @returns 缩放尺寸；入参非法返回 null
 */
export function fitInBox(
  width: number,
  height: number,
  boxWidth: number,
  boxHeight: number
): Size | null {
  if (width <= 0 || height <= 0 || boxWidth <= 0 || boxHeight <= 0) return null
  const scale = Math.min(boxWidth / width, boxHeight / height, 1)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

/**
 * 基准边长（纵向取宽 / 横向取高 / 网格取宽）
 * @param sizes 全部图片尺寸
 * @param sizeMode 首图 / 最大 / 固定
 * @param fixedSize 固定边长（sizeMode = fixed）
 * @param axis 取宽或取高
 * @returns 基准边长；无图或非法返回 null
 */
export function baseExtent(
  sizes: readonly Size[],
  sizeMode: SizeMode,
  fixedSize: number,
  axis: keyof Size
): number | null {
  if (sizes.length === 0) return null
  if (sizeMode === 'fixed') return fixedSize > 0 ? fixedSize : null
  if (sizeMode === 'first') {
    const first = sizes[0]
    if (first === undefined) return null
    return first[axis] > 0 ? first[axis] : null
  }
  let max = 0
  for (const size of sizes) max = Math.max(max, size[axis])
  return max > 0 ? max : null
}

/** 纵向：统一宽度，自上而下 */
function planVertical(
  sizes: readonly Size[],
  base: number,
  gutter: number,
  padding: number
): LayoutPlan | null {
  const placements: Placement[] = []
  let y = padding
  let contentHeight = 0
  for (const size of sizes) {
    const scaled = scaleToWidth(size.width, size.height, base)
    if (scaled === null) return null
    placements.push({ x: padding, y, width: scaled.width, height: scaled.height })
    y += scaled.height + gutter
    contentHeight += scaled.height
  }
  contentHeight += gutter * (sizes.length - 1)
  return {
    width: base + padding * 2,
    height: Math.max(1, contentHeight + padding * 2),
    placements
  }
}

/** 横向：统一高度，自左向右 */
function planHorizontal(
  sizes: readonly Size[],
  base: number,
  gutter: number,
  padding: number
): LayoutPlan | null {
  const placements: Placement[] = []
  let x = padding
  let contentWidth = 0
  for (const size of sizes) {
    const scaled = scaleToHeight(size.width, size.height, base)
    if (scaled === null) return null
    placements.push({ x, y: padding, width: scaled.width, height: scaled.height })
    x += scaled.width + gutter
    contentWidth += scaled.width
  }
  contentWidth += gutter * (sizes.length - 1)
  return {
    width: Math.max(1, contentWidth + padding * 2),
    height: base + padding * 2,
    placements
  }
}

/** 网格：等宽正方形单元格，图片 contain 居中 */
function planGrid(
  sizes: readonly Size[],
  base: number,
  columns: number,
  gutter: number,
  padding: number
): LayoutPlan | null {
  const cell = Math.floor((base - gutter * (columns - 1)) / columns)
  if (cell < 1) return null
  const rows = Math.ceil(sizes.length / columns)
  const placements: Placement[] = []
  for (const [index, size] of sizes.entries()) {
    const scaled = fitInBox(size.width, size.height, cell, cell)
    if (scaled === null) return null
    const row = Math.floor(index / columns)
    const column = index % columns
    placements.push({
      x: padding + column * (cell + gutter) + Math.floor((cell - scaled.width) / 2),
      y: padding + row * (cell + gutter) + Math.floor((cell - scaled.height) / 2),
      width: scaled.width,
      height: scaled.height
    })
  }
  return {
    width: base + padding * 2,
    height: Math.max(1, rows * cell + gutter * (rows - 1) + padding * 2),
    placements
  }
}

/**
 * 计算拼接布局（单一真相源）
 * @param sizes 全部图片原始尺寸（顺序即落位顺序）
 * @param layout 布局参数
 * @returns 画布尺寸与落位；无图/参数非法返回 null
 */
export function planLayout(sizes: readonly Size[], layout: LayoutOptions): LayoutPlan | null {
  if (sizes.length === 0) return null
  const gutter = clampInt(layout.gutter, 0, 100)
  const padding = clampInt(layout.padding, 0, 100)
  if (layout.mode === 'grid') {
    const base = baseExtent(sizes, layout.sizeMode, layout.fixedSize, 'width')
    if (base === null) return null
    return planGrid(sizes, base, clampInt(layout.columns, 2, 8), gutter, padding)
  }
  const axis: keyof Size = layout.mode === 'vertical' ? 'width' : 'height'
  const base = baseExtent(sizes, layout.sizeMode, layout.fixedSize, axis)
  if (base === null) return null
  return layout.mode === 'vertical'
    ? planVertical(sizes, base, gutter, padding)
    : planHorizontal(sizes, base, gutter, padding)
}

/**
 * 是否超出画布上限（单边 30,000px 或总像素 1 亿）
 * @param plan 布局结果
 */
export function planOverLimit(plan: LayoutPlan): boolean {
  return (
    plan.width > MAX_CANVAS_EDGE ||
    plan.height > MAX_CANVAS_EDGE ||
    plan.width * plan.height > MAX_CANVAS_PIXELS
  )
}

/**
 * 时间戳（本地时区 `yyyyMMdd-HHmmss`）
 * @param date 时间
 */
export function timestampName(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/**
 * 输出文件名：`拼接_{yyyyMMdd-HHmmss}.{ext}`
 * @param date 时间
 * @param ext 扩展名（不含点）
 */
export function outputFileName(date: Date, ext: string): string {
  return `拼接_${timestampName(date)}.${ext}`
}

/**
 * 编码器 → 文件扩展名（jpeg 用 jpg）
 * @param encoder 输出编码器
 */
export function extForEncoder(encoder: ImageEncoder): 'png' | 'jpg' | 'webp' {
  return encoder === 'jpeg' ? 'jpg' : encoder
}

// —— M40 长图分割（spec §3.6/§4） ——

/** 输出段数上限（防误切出上百段） */
export const MAX_SPLIT_SLICES = 100

/** 分割方式：固定高度 / 按份数 */
export type SplitMode = 'height' | 'parts'

/** 单段落位（y 为源图纵坐标，h 为段高） */
export interface SplitSlice {
  y: number
  h: number
}

/** 分割计划 */
export interface SplitPlan {
  slices: SplitSlice[]
}

/**
 * 计算长图分割计划（单一真相源，spec §4）
 * - height：段数 = ceil(图高 / 高度)，末段保留实际高度
 * - parts：`base = floor(高/份数)`，余数依次摊到前几段（`base + 1`）
 * @param height 源图高（px）
 * @param mode 分割方式
 * @param param 固定高度（height）或份数（parts）
 * @returns 切片计划；非法（参数 ≤0 / 份数 > 图高 / 段数 > 100）返回 null
 */
export function planSplit(height: number, mode: SplitMode, param: number): SplitPlan | null {
  if (!Number.isFinite(height) || height <= 0) return null
  const sourceHeight = Math.floor(height)
  const value = Math.floor(param)
  if (!Number.isFinite(value) || value <= 0) return null

  const slices: SplitSlice[] = []
  if (mode === 'height') {
    if (value < 1) return null
    const count = Math.ceil(sourceHeight / value)
    if (count > MAX_SPLIT_SLICES) return null
    for (let y = 0; y < sourceHeight; y += value) {
      slices.push({ y, h: Math.min(value, sourceHeight - y) })
    }
    return { slices }
  }

  if (value < 2 || value > sourceHeight || value > MAX_SPLIT_SLICES) return null
  const base = Math.floor(sourceHeight / value)
  const remainder = sourceHeight % value
  let y = 0
  for (let index = 0; index < value; index += 1) {
    const h = base + (index < remainder ? 1 : 0)
    slices.push({ y, h })
    y += h
  }
  return { slices }
}

/**
 * 分段文件名：`{原名}_part{序号}.{ext}`（序号 1 起，补零位 = max(2, 段数位数)）
 * @param inputName 输入文件名（含扩展名）
 * @param index 段序号（1 起）
 * @param total 总段数
 * @param ext 输出扩展名（不含点）
 */
export function splitFileName(
  inputName: string,
  index: number,
  total: number,
  ext: string
): string {
  const dot = inputName.lastIndexOf('.')
  const stem = dot <= 0 ? inputName : inputName.slice(0, dot)
  const digits = Math.max(2, String(Math.max(1, total)).length)
  const seq = String(Math.max(1, Math.round(index))).padStart(digits, '0')
  return `${stem}_part${seq}.${ext}`
}
