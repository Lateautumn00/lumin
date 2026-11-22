/**
 * @file ruler.ts 屏幕标尺纯函数（像素 → 尺寸 / 对角线 / 厘米 / 英寸）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 截图原始像素为唯一事实来源；厘米/英寸按用户可调 DPI 名义换算，
 *              逻辑像素按显示器缩放比换算。所有函数无副作用，便于单测。
 */

/** 默认名义 DPI */
export const DEFAULT_DPI = 96

/** DPI 可调下限 */
export const MIN_DPI = 48

/** DPI 可调上限 */
export const MAX_DPI = 600

const CM_PER_INCH = 2.54

/** 屏幕坐标点 */
export interface RulerPoint {
  readonly x: number
  readonly y: number
}

/** 归一化后的矩形（左上角 + 非负宽高，整数像素） */
export interface RulerRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** 测量结果 */
export interface RulerMetrics {
  readonly widthPx: number
  readonly heightPx: number
  readonly diagonalPx: number
  readonly widthLogicalPx: number
  readonly heightLogicalPx: number
  readonly widthCm: number
  readonly heightCm: number
  readonly diagonalCm: number
  readonly widthIn: number
  readonly heightIn: number
  readonly diagonalIn: number
}

/**
 * DPI 是否有效（有限数且在 48–600 内）
 * @param value 待校验 DPI
 */
export function isValidDpi(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_DPI && value <= MAX_DPI
}

/**
 * 拖拽起止点 → 归一化矩形（像素取整，宽高非负）
 * @param start 起点
 * @param end 终点
 */
export function normalizeRect(start: RulerPoint, end: RulerPoint): RulerRect {
  const left = Math.round(Math.min(start.x, end.x))
  const top = Math.round(Math.min(start.y, end.y))
  return {
    x: left,
    y: top,
    width: Math.abs(Math.round(end.x - start.x)),
    height: Math.abs(Math.round(end.y - start.y))
  }
}

/**
 * 像素 → 厘米（按名义 DPI）
 * @param px 像素值
 * @param dpi 名义 DPI
 */
export function pxToCm(px: number, dpi: number): number {
  return (px / dpi) * CM_PER_INCH
}

/**
 * 像素 → 英寸（按名义 DPI）
 * @param px 像素值
 * @param dpi 名义 DPI
 */
export function pxToInch(px: number, dpi: number): number {
  return px / dpi
}

/** 保留两位小数 */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 矩形测量：物理像素、对角线、逻辑像素与 cm/inch 换算
 * @param rect 归一化矩形
 * @param dpi 名义 DPI（无效时回退默认 96）
 * @param scaleFactor 显示器缩放比（无效时回退 1）
 */
export function measureRect(rect: RulerRect, dpi: number, scaleFactor: number): RulerMetrics {
  const safeDpi = isValidDpi(dpi) ? dpi : DEFAULT_DPI
  const safeScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  const diagonalPx = Math.round(Math.hypot(rect.width, rect.height))
  return {
    widthPx: rect.width,
    heightPx: rect.height,
    diagonalPx,
    widthLogicalPx: Math.round(rect.width / safeScale),
    heightLogicalPx: Math.round(rect.height / safeScale),
    widthCm: round2(pxToCm(rect.width, safeDpi)),
    heightCm: round2(pxToCm(rect.height, safeDpi)),
    diagonalCm: round2(pxToCm(diagonalPx, safeDpi)),
    widthIn: round2(pxToInch(rect.width, safeDpi)),
    heightIn: round2(pxToInch(rect.height, safeDpi)),
    diagonalIn: round2(pxToInch(diagonalPx, safeDpi))
  }
}

/**
 * 测量结果 → 可复制的文本摘要
 * @param metrics 测量结果
 */
export function rulerSummary(metrics: RulerMetrics): string {
  return [
    `宽 ${metrics.widthPx} px / ${metrics.widthCm} cm / ${metrics.widthIn} in`,
    `高 ${metrics.heightPx} px / ${metrics.heightCm} cm / ${metrics.heightIn} in`,
    `对角线 ${metrics.diagonalPx} px / ${metrics.diagonalCm} cm / ${metrics.diagonalIn} in`,
    `逻辑尺寸 ${metrics.widthLogicalPx} × ${metrics.heightLogicalPx} px`
  ].join('\n')
}
