/**
 * @file contract.ts 纯函数契约（水印几何/命名/编码器）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 九宫格锚点、平铺网格、旋转归一、透明度与输出命名；
 *              renderer 预览与 worker 出图共用同一套布局真相源（spec §4）。
 */
import { baseName } from '@lumin/shared'
import type { Encoder, Position } from './schema'

/** 平铺点数硬上限（防大图 + 小水印导致内存/耗时爆炸） */
export const MAX_TILE_POINTS = 2000

/** 平铺步长倍率（相对旋转后包围盒） */
export const TILE_STEP_X = 1.6
export const TILE_STEP_Y = 2.0

/** 尺寸 */
export interface Size {
  width: number
  height: number
}

/** 中心点坐标 */
export interface Point {
  x: number
  y: number
}

/**
 * 图片短边（字号/宽度/边距的百分比基准）
 * @param width 图片宽
 * @param height 图片高
 */
export function shortEdge(width: number, height: number): number {
  return Math.min(width, height)
}

/**
 * 百分比 → 像素（至少 1px）
 * @param pct 百分比（0–100）
 * @param edge 基准边像素
 */
export function percentToPx(pct: number, edge: number): number {
  return Math.max(1, Math.round((pct / 100) * edge))
}

/**
 * 文字水印字号像素
 * @param sizePct 占短边百分比（2–50）
 * @param edge 短边像素
 */
export function textFontSize(sizePct: number, edge: number): number {
  return percentToPx(sizePct, edge)
}

/**
 * 文字水印包围盒高度（行高近似 1.2 倍字号）
 * @param fontPx 字号像素
 */
export function textHeight(fontPx: number): number {
  return Math.max(1, Math.ceil(fontPx * 1.2))
}

/**
 * 图片水印等比尺寸（宽度 = 短边百分比，高度按原始比例）
 * @param naturalWidth 水印图原始宽
 * @param naturalHeight 水印图原始高
 * @param sizePct 宽度占短边百分比
 * @param edge 短边像素
 * @returns 尺寸；原始尺寸或基准非法时返回 null
 */
export function imageWatermarkSize(
  naturalWidth: number,
  naturalHeight: number,
  sizePct: number,
  edge: number
): Size | null {
  if (naturalWidth <= 0 || naturalHeight <= 0 || edge <= 0) return null
  const width = percentToPx(sizePct, edge)
  const height = Math.max(1, Math.round((naturalHeight / naturalWidth) * width))
  return { width, height }
}

/**
 * 旋转角度归一：(-180, 180]
 * @param deg 任意角度
 */
export function normalizeRotation(deg: number): number {
  let value = deg % 360
  if (value > 180) value -= 360
  if (value <= -180) value += 360
  return value
}

/**
 * 不透明度百分比 → 0.05–1
 * @param pct 百分比（5–100）
 */
export function clampOpacity(pct: number): number {
  return Math.min(1, Math.max(0.05, pct / 100))
}

/** 中心点夹取到画布内（水印大于画布时居中） */
function clampCenter(value: number, size: number, canvasSize: number): number {
  if (size >= canvasSize) return canvasSize / 2
  return Math.min(canvasSize - size / 2, Math.max(size / 2, value))
}

/**
 * 九宫格锚点（返回水印中心坐标，旋转围绕该点）
 * @param canvasW 画布宽
 * @param canvasH 画布高
 * @param wmW 水印宽
 * @param wmH 水印高
 * @param position 九宫格位置
 * @param marginPx 边距像素
 */
export function anchorPosition(
  canvasW: number,
  canvasH: number,
  wmW: number,
  wmH: number,
  position: Position,
  marginPx: number
): Point {
  const margin = Math.max(0, Math.min(marginPx, shortEdge(canvasW, canvasH) / 2))
  const [vertical, horizontal] = position.split('-')
  const x =
    horizontal === 'left'
      ? margin + wmW / 2
      : horizontal === 'right'
        ? canvasW - margin - wmW / 2
        : canvasW / 2
  const y =
    vertical === 'top'
      ? margin + wmH / 2
      : vertical === 'bottom'
        ? canvasH - margin - wmH / 2
        : canvasH / 2
  return {
    x: clampCenter(x, wmW, canvasW),
    y: clampCenter(y, wmH, canvasH)
  }
}

/**
 * 旋转后包围盒（用于平铺步长，避免斜放水印相互压盖）
 * @param width 水印宽
 * @param height 水印高
 * @param rotationDeg 旋转角度
 */
export function rotatedBounds(width: number, height: number, rotationDeg: number): Size {
  const rad = (normalizeRotation(rotationDeg) * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos
  }
}

/**
 * 平铺网格中心点（从左上起按步长铺满画布，含部分出画的边缘行列）。
 * 点数超过 `MAX_TILE_POINTS` 时截断。
 * @param canvasW 画布宽
 * @param canvasH 画布高
 * @param wmW 水印宽
 * @param wmH 水印高
 * @param rotationDeg 旋转角度（按旋转后包围盒取步长）
 */
export function tilePositions(
  canvasW: number,
  canvasH: number,
  wmW: number,
  wmH: number,
  rotationDeg = 0
): Point[] {
  if (canvasW <= 0 || canvasH <= 0 || wmW <= 0 || wmH <= 0) return []
  const bounds = rotatedBounds(wmW, wmH, rotationDeg)
  const stepX = Math.max(1, bounds.width * TILE_STEP_X)
  const stepY = Math.max(1, bounds.height * TILE_STEP_Y)
  const points: Point[] = []
  for (let y = stepY / 2; y < canvasH; y += stepY) {
    for (let x = stepX / 2; x < canvasW; x += stepX) {
      points.push({ x, y })
      if (points.length >= MAX_TILE_POINTS) return points
    }
  }
  return points
}

/**
 * 输出文件名：`{原名}_水印{ext}`（扩展名原样保留）
 * @param inputPath 源图片路径
 */
export function outputName(inputPath: string): string {
  const base = baseName(inputPath)
  if (base === inputPath) return `${inputPath}_水印`
  return `${base}_水印${inputPath.slice(base.length)}`
}

/**
 * 扩展名 → 编码器（输出格式跟随原格式）
 * @param pathOrName 文件路径或文件名
 * @returns 编码器；白名单外返回 null
 */
export function encoderFor(pathOrName: string): Encoder | null {
  const dot = pathOrName.lastIndexOf('.')
  const ext = dot < 0 ? '' : pathOrName.slice(dot + 1).toLowerCase()
  if (ext === 'png') return 'png'
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg'
  if (ext === 'webp') return 'webp'
  return null
}
