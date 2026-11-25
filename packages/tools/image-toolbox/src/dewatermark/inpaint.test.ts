/**
 * @file inpaint.test.ts 填充纯函数单测（Telea / 边缘均色 / 纯色 / 盒式模糊）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 用合成 RGBA 缓冲断言像素级结果，避免依赖 canvas
 */
import { describe, expect, it } from 'vitest'
import { averageEdgeColor, blurRegion, fillSolid, teleaInpaint } from './inpaint'

/** 生成纯色 RGBA 缓冲 */
function solid(
  width: number,
  height: number,
  color: [number, number, number, number]
): Uint8ClampedArray {
  const buffer = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    buffer[i * 4] = color[0]
    buffer[i * 4 + 1] = color[1]
    buffer[i * 4 + 2] = color[2]
    buffer[i * 4 + 3] = color[3]
  }
  return buffer
}

/** 读取像素 */
function pixel(
  buffer: Uint8ClampedArray,
  width: number,
  x: number,
  y: number
): [number, number, number, number] {
  const p = (y * width + x) * 4
  return [buffer[p] ?? 0, buffer[p + 1] ?? 0, buffer[p + 2] ?? 0, buffer[p + 3] ?? 0]
}

describe('teleaInpaint', () => {
  it('均匀背景中的单点掩码被恢复为背景色', () => {
    const width = 5
    const height = 5
    const buffer = solid(width, height, [10, 20, 30, 255])
    const mask = new Uint8Array(width * height)
    mask[2 * width + 2] = 1
    teleaInpaint(buffer, width, height, mask)
    expect(pixel(buffer, width, 2, 2)).toEqual([10, 20, 30, 255])
  })

  it('2×2 洞由外向内推进填满', () => {
    const width = 6
    const height = 6
    const buffer = solid(width, height, [200, 100, 50, 255])
    const mask = new Uint8Array(width * height)
    for (const [x, y] of [
      [2, 2],
      [3, 2],
      [2, 3],
      [3, 3]
    ] as const) {
      mask[y * width + x] = 1
    }
    teleaInpaint(buffer, width, height, mask)
    for (const [x, y] of [
      [2, 2],
      [3, 2],
      [2, 3],
      [3, 3]
    ] as const) {
      expect(pixel(buffer, width, x, y)).toEqual([200, 100, 50, 255])
    }
  })

  it('全掩码无已知像素时保持原样', () => {
    const width = 3
    const height = 3
    const buffer = solid(width, height, [1, 2, 3, 4])
    const mask = new Uint8Array(width * height).fill(1)
    teleaInpaint(buffer, width, height, mask)
    expect(pixel(buffer, width, 1, 1)).toEqual([1, 2, 3, 4])
  })

  it('贴边掩码跳过越界邻域并正确回填', () => {
    const width = 5
    const height = 5
    const buffer = solid(width, height, [40, 50, 60, 255])
    const mask = new Uint8Array(width * height)
    mask[0] = 1
    teleaInpaint(buffer, width, height, mask)
    expect(pixel(buffer, width, 0, 0)).toEqual([40, 50, 60, 255])
  })

  it('非法尺寸直接返回', () => {
    const buffer = new Uint8ClampedArray(4)
    teleaInpaint(buffer, 0, 0, new Uint8Array(0))
    expect(buffer[0]).toBe(0)
  })
})

describe('averageEdgeColor', () => {
  it('默认取区域外 1px 环均值', () => {
    const width = 5
    const height = 5
    const buffer = solid(width, height, [255, 255, 255, 255])
    // 区域内部涂红，环外仍为白
    const region = { x: 1, y: 1, width: 3, height: 3 }
    for (let y = 1; y < 4; y++) {
      for (let x = 1; x < 4; x++) {
        const p = (y * width + x) * 4
        buffer[p] = 255
        buffer[p + 1] = 0
        buffer[p + 2] = 0
      }
    }
    expect(averageEdgeColor(buffer, width, height, region)).toEqual([255, 255, 255, 255])
  })

  it('区域覆盖整图时坐标夹取到边界', () => {
    const buffer = solid(3, 3, [12, 34, 56, 255])
    expect(averageEdgeColor(buffer, 3, 3, { x: 0, y: 0, width: 3, height: 3 })).toEqual([
      12, 34, 56, 255
    ])
  })
})

describe('fillSolid', () => {
  it('只填充区域，外部保持零值', () => {
    const width = 4
    const height = 4
    const buffer = new Uint8ClampedArray(width * height * 4)
    fillSolid(buffer, width, height, { x: 1, y: 1, width: 2, height: 2 }, [9, 8, 7, 6])
    expect(pixel(buffer, width, 1, 1)).toEqual([9, 8, 7, 6])
    expect(pixel(buffer, width, 2, 2)).toEqual([9, 8, 7, 6])
    expect(pixel(buffer, width, 0, 0)).toEqual([0, 0, 0, 0])
    expect(pixel(buffer, width, 3, 3)).toEqual([0, 0, 0, 0])
  })
})

describe('blurRegion', () => {
  it('均匀区域模糊后颜色不变', () => {
    const width = 8
    const height = 8
    const buffer = solid(width, height, [80, 90, 100, 255])
    blurRegion(buffer, width, height, { x: 2, y: 2, width: 4, height: 4 }, 3)
    expect(pixel(buffer, width, 3, 3)).toEqual([80, 90, 100, 255])
  })

  it('单点亮斑被摊平到邻域', () => {
    const width = 9
    const height = 9
    const buffer = solid(width, height, [0, 0, 0, 255])
    const center = (4 * width + 4) * 4
    buffer[center] = 255
    buffer[center + 1] = 255
    buffer[center + 2] = 255
    blurRegion(buffer, width, height, { x: 2, y: 2, width: 5, height: 5 }, 1)
    const [r, g, b] = pixel(buffer, width, 4, 4)
    expect(r).toBeLessThan(255)
    expect(r).toBeGreaterThan(0)
    expect(g).toBe(r)
    expect(b).toBe(r)
    expect(pixel(buffer, width, 0, 0)).toEqual([0, 0, 0, 255])
  })

  it('空区域或非法半径安全返回', () => {
    const width = 4
    const height = 4
    const buffer = solid(width, height, [5, 5, 5, 255])
    blurRegion(buffer, width, height, { x: 0, y: 0, width: 0, height: 0 }, 4)
    blurRegion(buffer, width, height, { x: 0, y: 0, width: 4, height: 4 }, 0)
    expect(pixel(buffer, width, 2, 2)).toEqual([5, 5, 5, 255])
  })
})
