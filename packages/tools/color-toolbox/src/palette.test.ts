import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ALPHA_THRESHOLD,
  DEFAULT_MAX_PALETTE_COLORS,
  extractPalette,
  paletteText
} from './palette'

type Pixel = readonly [number, number, number, number]

function pixelsOf(pixels: readonly Pixel[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels.length * 4)
  pixels.forEach((pixel, index) => {
    data.set(pixel, index * 4)
  })
  return data
}

const RED = [255, 0, 0, 255] as const
const BLUE = [0, 0, 255, 255] as const
const GREEN = [0, 255, 0, 255] as const
const CLEAR = [0, 0, 0, 0] as const
const HALF_CLEAR = [0, 0, 0, 100] as const

describe('extractPalette', () => {
  it('单色图片返回 1 个颜色，占比 100%', () => {
    const result = extractPalette(pixelsOf([RED, RED, RED, RED]))
    expect(result.totalPixels).toBe(4)
    expect(result.colors).toHaveLength(1)
    expect(result.colors[0]).toEqual({
      rgb: { r: 255, g: 0, b: 0 },
      hex: '#FF0000',
      count: 4,
      percent: 100
    })
  })

  it('多色按占比降序，同占比按量化桶升序（可复现）', () => {
    const result = extractPalette(pixelsOf([RED, RED, BLUE, BLUE, BLUE, GREEN]))
    expect(result.totalPixels).toBe(6)
    expect(result.colors.map((color) => color.hex)).toEqual(['#0000FF', '#FF0000', '#00FF00'])
    expect(result.colors.map((color) => color.percent)).toEqual([50, 33.3, 16.7])

    const tie = extractPalette(pixelsOf([RED, BLUE]))
    expect(tie.colors.map((color) => color.hex)).toEqual(['#0000FF', '#FF0000'])
  })

  it('忽略 alpha 低于阈值的透明像素', () => {
    const result = extractPalette(pixelsOf([RED, CLEAR, HALF_CLEAR]))
    expect(result.totalPixels).toBe(1)
    expect(result.colors.map((color) => color.hex)).toEqual(['#FF0000'])
  })

  it('alphaThreshold 可调（0 时透明像素也参与统计）', () => {
    const result = extractPalette(pixelsOf([RED, CLEAR, CLEAR]), { alphaThreshold: 0 })
    expect(DEFAULT_ALPHA_THRESHOLD).toBe(128)
    expect(result.totalPixels).toBe(3)
    expect(result.colors).toHaveLength(2)
    expect(result.colors[0]?.percent).toBe(66.7)
  })

  it('相近颜色量化到同一桶并取平均色', () => {
    const result = extractPalette(
      pixelsOf([
        [59, 130, 246, 255],
        [60, 131, 247, 255]
      ])
    )
    expect(result.colors).toHaveLength(1)
    expect(result.colors[0]?.hex).toBe('#3C83F7')
  })

  it('maxColors 限制返回数量，占比仍按全量统计', () => {
    const result = extractPalette(pixelsOf([RED, BLUE, GREEN, [255, 255, 0, 255]]), {
      maxColors: 2
    })
    expect(DEFAULT_MAX_PALETTE_COLORS).toBe(8)
    expect(result.colors).toHaveLength(2)
    expect(result.colors[0]?.percent).toBe(25)
    expect(result.totalPixels).toBe(4)
  })

  it('maxColors 越界收敛到 1–32', () => {
    const pixels = pixelsOf([RED, BLUE, GREEN])
    expect(extractPalette(pixels, { maxColors: 0 }).colors).toHaveLength(1)
    expect(extractPalette(pixels, { maxColors: 999 }).colors).toHaveLength(3)
  })

  it('空输入与全透明图片返回空色板', () => {
    expect(extractPalette(new Uint8ClampedArray(0))).toEqual({ colors: [], totalPixels: 0 })
    expect(extractPalette(pixelsOf([CLEAR, CLEAR]))).toEqual({ colors: [], totalPixels: 0 })
  })

  it('长度非 4 的整数倍时忽略尾部字节', () => {
    const data = pixelsOf([RED])
    const padded = new Uint8ClampedArray(7)
    padded.set(data.subarray(0, 4), 0)
    padded.set([9, 9, 9], 4)
    const result = extractPalette(padded)
    expect(result.totalPixels).toBe(1)
    expect(result.colors.map((color) => color.hex)).toEqual(['#FF0000'])
  })
})

describe('paletteText', () => {
  it('拼成逗号分隔的 HEX 列表', () => {
    const result = extractPalette(pixelsOf([RED, BLUE]))
    expect(paletteText(result.colors)).toBe('#0000FF, #FF0000')
    expect(paletteText([])).toBe('')
  })
})
