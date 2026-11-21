/**
 * @file 图片主色提取纯函数（像素量化 + 占比聚合）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 契约见 docs/spec/color-toolbox.md §2.6 / §3；输入为 canvas `getImageData` 的 RGBA 数据，
 *              不依赖 DOM/Node，同输入必得同输出（排序稳定）。
 */
import { rgbToHex, type Rgb } from './color'

/** 调色板单个颜色 */
export interface PaletteColor {
  /** 该色簇的平均颜色 */
  readonly rgb: Rgb
  /** `#RRGGBB`（大写） */
  readonly hex: string
  /** 命中的像素数 */
  readonly count: number
  /** 占参与统计的不透明像素百分比（保留 1 位小数） */
  readonly percent: number
}

/** 调色板提取结果 */
export interface PaletteResult {
  /** 按占比降序（同占比按量化桶升序，保证可复现） */
  readonly colors: readonly PaletteColor[]
  /** 参与统计的不透明像素总数 */
  readonly totalPixels: number
}

/** 提取选项 */
export interface PaletteOptions {
  /** 返回的颜色数上限（1–32，默认 8） */
  readonly maxColors?: number
  /** 透明阈值（0–255，默认 128）：像素 alpha 小于该值视为透明并忽略 */
  readonly alphaThreshold?: number
}

/** 默认返回颜色数 */
export const DEFAULT_MAX_PALETTE_COLORS = 8

/** 默认透明阈值 */
export const DEFAULT_ALPHA_THRESHOLD = 128

/** 每通道量化档数：取高 4 位 → 16 档，总桶数 16³ = 4096 */
const BUCKET_BITS = 4
const BUCKET_LEVELS = 1 << (8 - BUCKET_BITS)
const BUCKET_TOTAL = BUCKET_LEVELS ** 3
const MAX_COLORS_LIMIT = 32

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function bucketOf(r: number, g: number, b: number): number {
  const shift = 8 - BUCKET_BITS
  return ((r >> shift) << (BUCKET_BITS * 2)) | ((g >> shift) << BUCKET_BITS) | (b >> shift)
}

/**
 * 从 RGBA 像素数据提取主色
 * @param pixels canvas `ImageData.data`（长度非 4 的倍数的尾部字节忽略）
 * @param options 提取选项
 * @returns 颜色按占比降序；无不透明像素时 `colors` 为空
 */
export function extractPalette(
  pixels: Uint8ClampedArray,
  options: PaletteOptions = {}
): PaletteResult {
  const maxColors = clampInt(options.maxColors ?? DEFAULT_MAX_PALETTE_COLORS, 1, MAX_COLORS_LIMIT)
  const alphaThreshold = clampInt(options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD, 0, 255)
  const counts = new Uint32Array(BUCKET_TOTAL)
  const sumR = new Uint32Array(BUCKET_TOTAL)
  const sumG = new Uint32Array(BUCKET_TOTAL)
  const sumB = new Uint32Array(BUCKET_TOTAL)

  const pixelCount = Math.floor(pixels.length / 4)
  let totalPixels = 0
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4
    if ((pixels[offset + 3] ?? 0) < alphaThreshold) continue
    const r = pixels[offset] ?? 0
    const g = pixels[offset + 1] ?? 0
    const b = pixels[offset + 2] ?? 0
    const bucket = bucketOf(r, g, b)
    counts[bucket] = (counts[bucket] ?? 0) + 1
    sumR[bucket] = (sumR[bucket] ?? 0) + r
    sumG[bucket] = (sumG[bucket] ?? 0) + g
    sumB[bucket] = (sumB[bucket] ?? 0) + b
    totalPixels += 1
  }

  if (totalPixels === 0) return { colors: [], totalPixels }

  const candidates: { bucket: number; count: number }[] = []
  for (let bucket = 0; bucket < BUCKET_TOTAL; bucket += 1) {
    const count = counts[bucket] ?? 0
    if (count > 0) candidates.push({ bucket, count })
  }
  candidates.sort((left, right) => right.count - left.count || left.bucket - right.bucket)

  const colors = candidates.slice(0, maxColors).map<PaletteColor>(({ bucket, count }) => {
    const rgb: Rgb = {
      r: Math.round((sumR[bucket] ?? 0) / count),
      g: Math.round((sumG[bucket] ?? 0) / count),
      b: Math.round((sumB[bucket] ?? 0) / count)
    }
    return {
      rgb,
      hex: rgbToHex(rgb),
      count,
      percent: Math.round((count / totalPixels) * 1000) / 10
    }
  })

  return { colors, totalPixels }
}

/**
 * 调色板 → 复制文本（`#A, #B, …`）
 * @param colors 调色板颜色
 */
export function paletteText(colors: readonly PaletteColor[]): string {
  return colors.map((color) => color.hex).join(', ')
}
