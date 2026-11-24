/**
 * @file inpaint.ts RGBA 填充纯函数（Telea 近似 / 边缘均值纯色 / 分离式盒式模糊）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 输入均为整图 RGBA `Uint8ClampedArray` + 区域，原地修改；无第三方依赖（spec §4.2）
 */
import { readChannel } from './contract'
import type { Region } from './schema'

/** 颜色（RGBA，0–255） */
export type Rgba = [number, number, number, number]

/** 四邻域（边界种子） */
const SEED_DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1]
]

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * Telea 近似快速修复：边界像素按层入队（由外向内 BFS），
 * 每个待填像素取 8 邻域中已知像素的 `1/d²` 加权平均。
 * 全掩码且无已知像素时保持原样。
 * @param pixels 整图 RGBA
 * @param width 图宽
 * @param height 图高
 * @param mask 长度 = width×height，1 表示待填充
 */
export function teleaInpaint(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array
): void {
  if (width <= 0 || height <= 0) return
  const total = width * height
  const filled = new Uint8Array(total)
  const queued = new Uint8Array(total)
  const queue: number[] = []

  // 边界种子：掩码像素且 4 邻域存在已知像素（BFS 由外向内）
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      if (mask[index] !== 1) continue
      let boundary = false
      for (const [dx, dy] of SEED_DIRS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        if (mask[ny * width + nx] !== 1) {
          boundary = true
          break
        }
      }
      if (boundary) {
        queued[index] = 1
        queue.push(index)
      }
    }
  }

  // 队列随 push 增长，天然按层推进
  for (const index of queue) {
    const x = index % width
    const y = (index - x) / width
    let sumR = 0
    let sumG = 0
    let sumB = 0
    let sumA = 0
    let sumWeight = 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const neighbor = ny * width + nx
        // 已知像素或已填充像素才可作为参考
        if (mask[neighbor] === 1 && filled[neighbor] !== 1) continue
        const weight = 1 / (dx * dx + dy * dy)
        const p = neighbor * 4
        sumR += readChannel(pixels, p) * weight
        sumG += readChannel(pixels, p + 1) * weight
        sumB += readChannel(pixels, p + 2) * weight
        sumA += readChannel(pixels, p + 3) * weight
        sumWeight += weight
      }
    }
    const p = index * 4
    pixels[p] = Math.round(sumR / sumWeight)
    pixels[p + 1] = Math.round(sumG / sumWeight)
    pixels[p + 2] = Math.round(sumB / sumWeight)
    pixels[p + 3] = Math.round(sumA / sumWeight)
    filled[index] = 1

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const neighbor = ny * width + nx
        if (mask[neighbor] !== 1 || filled[neighbor] === 1 || queued[neighbor] === 1) continue
        queued[neighbor] = 1
        queue.push(neighbor)
      }
    }
  }
}

/**
 * 区域外 1px 环均值色（坐标夹取到图像边界）
 * @param pixels 整图 RGBA
 * @param width 图宽
 * @param height 图高
 * @param region 目标区域
 */
export function averageEdgeColor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  region: Region
): Rgba {
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let sumA = 0
  let count = 0
  const add = (x: number, y: number): void => {
    const cx = clampInt(x, 0, width - 1)
    const cy = clampInt(y, 0, height - 1)
    const p = (cy * width + cx) * 4
    sumR += readChannel(pixels, p)
    sumG += readChannel(pixels, p + 1)
    sumB += readChannel(pixels, p + 2)
    sumA += readChannel(pixels, p + 3)
    count += 1
  }
  const x0 = region.x
  const y0 = region.y
  const x1 = region.x + region.width
  const y1 = region.y + region.height
  for (let x = x0 - 1; x <= x1; x++) {
    add(x, y0 - 1)
    add(x, y1)
  }
  for (let y = y0; y < y1; y++) {
    add(x0 - 1, y)
    add(x1, y)
  }
  return [
    Math.round(sumR / count),
    Math.round(sumG / count),
    Math.round(sumB / count),
    Math.round(sumA / count)
  ]
}

/**
 * 区域填充纯色
 * @param pixels 整图 RGBA
 * @param width 图宽
 * @param height 图高
 * @param region 目标区域
 * @param color RGBA 颜色
 */
export function fillSolid(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  region: Region,
  color: Rgba
): void {
  const x0 = clampInt(region.x, 0, width)
  const y0 = clampInt(region.y, 0, height)
  const x1 = clampInt(region.x + region.width, 0, width)
  const y1 = clampInt(region.y + region.height, 0, height)
  const [r, g, b, a] = color
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * width + x) * 4
      pixels[p] = r
      pixels[p + 1] = g
      pixels[p + 2] = b
      pixels[p + 3] = a
    }
  }
}

/**
 * 可分离盒式模糊（水平 + 垂直滑窗，采样坐标夹取到图像边界），只写回区域
 * @param pixels 整图 RGBA
 * @param width 图宽
 * @param height 图高
 * @param region 目标区域
 * @param radius 半径像素（≥1）
 */
export function blurRegion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  region: Region,
  radius: number
): void {
  const r = Math.max(1, Math.round(radius))
  const x0 = clampInt(region.x, 0, width)
  const y0 = clampInt(region.y, 0, height)
  const w = Math.max(0, clampInt(region.width, 0, width - x0))
  const h = Math.max(0, clampInt(region.height, 0, height - y0))
  if (w * h === 0) return
  const count = r * 2 + 1
  const temp = new Float32Array(w * h * 4)

  // 水平方向：整图行内采样，结果写入 temp
  for (let row = 0; row < h; row++) {
    const yy = y0 + row
    let sumR = 0
    let sumG = 0
    let sumB = 0
    let sumA = 0
    for (let k = -r; k <= r; k++) {
      const xx = clampInt(x0 + k, 0, width - 1)
      const p = (yy * width + xx) * 4
      sumR += readChannel(pixels, p)
      sumG += readChannel(pixels, p + 1)
      sumB += readChannel(pixels, p + 2)
      sumA += readChannel(pixels, p + 3)
    }
    for (let col = 0; col < w; col++) {
      const t = (row * w + col) * 4
      temp[t] = sumR / count
      temp[t + 1] = sumG / count
      temp[t + 2] = sumB / count
      temp[t + 3] = sumA / count
      const outX = clampInt(x0 + col - r, 0, width - 1)
      const inX = clampInt(x0 + col + r + 1, 0, width - 1)
      const outP = (yy * width + outX) * 4
      const inP = (yy * width + inX) * 4
      sumR += readChannel(pixels, inP) - readChannel(pixels, outP)
      sumG += readChannel(pixels, inP + 1) - readChannel(pixels, outP + 1)
      sumB += readChannel(pixels, inP + 2) - readChannel(pixels, outP + 2)
      sumA += readChannel(pixels, inP + 3) - readChannel(pixels, outP + 3)
    }
  }

  // 垂直方向：在 temp 上滑窗，写回整图区域
  for (let col = 0; col < w; col++) {
    let sumR = 0
    let sumG = 0
    let sumB = 0
    let sumA = 0
    for (let k = -r; k <= r; k++) {
      const row = clampInt(k, 0, h - 1)
      const t = (row * w + col) * 4
      sumR += readChannel(temp, t)
      sumG += readChannel(temp, t + 1)
      sumB += readChannel(temp, t + 2)
      sumA += readChannel(temp, t + 3)
    }
    for (let row = 0; row < h; row++) {
      const p = ((y0 + row) * width + (x0 + col)) * 4
      pixels[p] = Math.round(sumR / count)
      pixels[p + 1] = Math.round(sumG / count)
      pixels[p + 2] = Math.round(sumB / count)
      pixels[p + 3] = Math.round(sumA / count)
      const outRow = clampInt(row - r, 0, h - 1)
      const inRow = clampInt(row + r + 1, 0, h - 1)
      const outT = (outRow * w + col) * 4
      const inT = (inRow * w + col) * 4
      sumR += readChannel(temp, inT) - readChannel(temp, outT)
      sumG += readChannel(temp, inT + 1) - readChannel(temp, outT + 1)
      sumB += readChannel(temp, inT + 2) - readChannel(temp, outT + 2)
      sumA += readChannel(temp, inT + 3) - readChannel(temp, outT + 3)
    }
  }
}
