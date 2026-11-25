/**
 * @file contract.ts 纯函数契约（区域归一/坐标换算/命名/编码器）
 * @author cuilanchao
 * @date 2026-11-24
 * @description renderer 框选预览与 worker 出图共用同一套区域真相源（spec §4.1）
 */
import { baseName } from '@lumin/shared'
import { MAX_DIMENSION, MAX_REGIONS, MIN_REGION_SIZE, type Encoder, type Region } from './schema'

/** 快速修复单区域面积上限（超过降级模糊，防内存/耗时爆炸） */
export const INPAINT_MAX_AREA = 2_000_000

/** inpaint 子图外扩像素（边缘采样，≤16） */
export const INPAINT_MARGIN = 4

/** 尺寸 */
export interface Size {
  width: number
  height: number
}

/** 点坐标 */
export interface Point {
  x: number
  y: number
}

/** 预览定位（百分比 0–100） */
export interface PercentRect {
  left: number
  top: number
  width: number
  height: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 区域收敛到图像内并取整（宽或高不足 2px 返回 null）
 * @param region 原始矩形
 * @param imageWidth 图片宽
 * @param imageHeight 图片高
 */
export function clampRegion(
  region: Region,
  imageWidth: number,
  imageHeight: number
): Region | null {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return null
  const x0 = clamp(Math.round(region.x), 0, imageWidth)
  const y0 = clamp(Math.round(region.y), 0, imageHeight)
  const x1 = clamp(Math.round(region.x + region.width), 0, imageWidth)
  const y1 = clamp(Math.round(region.y + region.height), 0, imageHeight)
  const width = x1 - x0
  const height = y1 - y0
  if (width < MIN_REGION_SIZE || height < MIN_REGION_SIZE) return null
  return { x: x0, y: y0, width, height }
}

/**
 * 批量归一：逐个收敛、丢弃非法、截断到上限
 * @param regions 原始矩形列表
 * @param imageWidth 图片宽
 * @param imageHeight 图片高
 * @param max 上限（默认 20）
 */
export function normalizeRegions(
  regions: readonly Region[],
  imageWidth: number,
  imageHeight: number,
  max = MAX_REGIONS
): Region[] {
  const result: Region[] = []
  for (const region of regions) {
    const clamped = clampRegion(region, imageWidth, imageHeight)
    if (clamped !== null) result.push(clamped)
    if (result.length >= max) break
  }
  return result
}

/**
 * 区域外扩并夹取到图像内（供 inpaint 边缘采样）
 * @param region 目标区域
 * @param margin 外扩像素
 * @param imageWidth 图片宽
 * @param imageHeight 图片高
 */
export function expandRegion(
  region: Region,
  margin: number,
  imageWidth: number,
  imageHeight: number
): Region {
  const m = Math.max(0, Math.round(margin))
  const x0 = clamp(region.x - m, 0, imageWidth)
  const y0 = clamp(region.y - m, 0, imageHeight)
  const x1 = clamp(region.x + region.width + m, 0, imageWidth)
  const y1 = clamp(region.y + region.height + m, 0, imageHeight)
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
}

/**
 * 区域面积（像素）
 * @param region 矩形
 */
export function regionArea(region: Region): number {
  return region.width * region.height
}

/**
 * 是否超过快速修复面积上限
 * @param region 矩形
 * @param limit 面积上限（默认 2M）
 */
export function isRegionOversized(region: Region, limit = INPAINT_MAX_AREA): boolean {
  return regionArea(region) > limit
}

/**
 * 两点 → 归一矩形（框选结束）；非法或过小返回 null
 * @param start 起点（原图像素）
 * @param end 终点（原图像素）
 * @param imageWidth 图片宽
 * @param imageHeight 图片高
 */
export function normalizeDraftRegion(
  start: Point,
  end: Point,
  imageWidth: number,
  imageHeight: number
): Region | null {
  const x0 = Math.min(start.x, end.x)
  const y0 = Math.min(start.y, end.y)
  const x1 = Math.max(start.x, end.x)
  const y1 = Math.max(start.y, end.y)
  return clampRegion({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, imageWidth, imageHeight)
}

/**
 * 平移区域并夹取在图内（宽/高超出图片时贴左上）
 * @param region 矩形
 * @param dx 横向位移
 * @param dy 纵向位移
 * @param imageWidth 图片宽
 * @param imageHeight 图片高
 */
export function moveRegion(
  region: Region,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number
): Region {
  const maxX = Math.max(0, imageWidth - region.width)
  const maxY = Math.max(0, imageHeight - region.height)
  return {
    ...region,
    x: clamp(Math.round(region.x + dx), 0, maxX),
    y: clamp(Math.round(region.y + dy), 0, maxY)
  }
}

/**
 * 显示坐标 → 原图坐标（夹取在图内）
 * @param point 显示坐标（预览元素内的相对像素）
 * @param display 预览元素尺寸
 * @param image 原图尺寸
 */
export function toImagePoint(point: Point, display: Size, image: Size): Point {
  if (display.width <= 0 || display.height <= 0) return { x: 0, y: 0 }
  return {
    x: clamp((point.x / display.width) * image.width, 0, image.width),
    y: clamp((point.y / display.height) * image.height, 0, image.height)
  }
}

/**
 * 原图矩形 → 预览百分比定位（样式层 left/top/width/height）
 * @param region 矩形
 * @param image 原图尺寸
 */
export function rectToPercent(region: Region, image: Size): PercentRect {
  if (image.width <= 0 || image.height <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 }
  }
  return {
    left: clamp((region.x / image.width) * 100, 0, 100),
    top: clamp((region.y / image.height) * 100, 0, 100),
    width: clamp((region.width / image.width) * 100, 0, 100),
    height: clamp((region.height / image.height) * 100, 0, 100)
  }
}

/**
 * 输出文件名：`{原名}_去水印{ext}`（扩展名原样保留）
 * @param inputPath 源图片路径
 */
export function outputName(inputPath: string): string {
  const base = baseName(inputPath)
  if (base === inputPath) return `${inputPath}_去水印`
  return `${base}_去水印${inputPath.slice(base.length)}`
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

/**
 * 读取通道值（调用方保证下标在范围内，`?? 0` 仅满足 noUncheckedIndexedAccess）
 * @param pixels RGBA 缓冲（整图或模糊中间缓冲）
 * @param index 通道下标
 */
export function readChannel(pixels: Uint8ClampedArray | Float32Array, index: number): number {
  return pixels[index] ?? 0
}

/** 导出上限常量，便于 UI/测试复用 schema 单一真相源 */
export { MAX_DIMENSION, MAX_REGIONS, MIN_REGION_SIZE }
