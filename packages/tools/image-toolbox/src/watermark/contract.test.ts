/**
 * @file contract.test.ts 纯函数契约单测（几何/命名/编码器）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import {
  anchorPosition,
  clampOpacity,
  encoderFor,
  imageWatermarkSize,
  MAX_TILE_POINTS,
  normalizeRotation,
  outputName,
  percentToPx,
  rotatedBounds,
  shortEdge,
  textFontSize,
  textHeight,
  tilePositions
} from './contract'

describe('基础度量', () => {
  it('shortEdge 取短边', () => {
    expect(shortEdge(1920, 1080)).toBe(1080)
    expect(shortEdge(800, 1200)).toBe(800)
  })

  it('percentToPx 四舍五入且最小 1px', () => {
    expect(percentToPx(8, 600)).toBe(48)
    expect(percentToPx(0.1, 100)).toBe(1)
    expect(percentToPx(0, 100)).toBe(1)
  })

  it('textFontSize 与 textHeight', () => {
    expect(textFontSize(10, 500)).toBe(50)
    expect(textHeight(50)).toBe(60)
    expect(textHeight(0)).toBe(1)
  })

  it('imageWatermarkSize 等比且拒绝非法尺寸', () => {
    expect(imageWatermarkSize(200, 100, 20, 1000)).toEqual({ width: 200, height: 100 })
    expect(imageWatermarkSize(100, 400, 10, 1000)).toEqual({ width: 100, height: 400 })
    expect(imageWatermarkSize(0, 100, 20, 1000)).toBeNull()
    expect(imageWatermarkSize(100, 100, 20, 0)).toBeNull()
  })
})

describe('normalizeRotation / clampOpacity', () => {
  it('归一到 (-180, 180]', () => {
    expect(normalizeRotation(0)).toBe(0)
    expect(normalizeRotation(180)).toBe(180)
    expect(normalizeRotation(181)).toBe(-179)
    expect(normalizeRotation(270)).toBe(-90)
    expect(normalizeRotation(-180)).toBe(180)
    expect(normalizeRotation(-270)).toBe(90)
  })

  it('不透明度夹取到 0.05–1', () => {
    expect(clampOpacity(30)).toBeCloseTo(0.3)
    expect(clampOpacity(0)).toBe(0.05)
    expect(clampOpacity(150)).toBe(1)
  })
})

describe('anchorPosition', () => {
  const canvasW = 1000
  const canvasH = 800
  const wmW = 100
  const wmH = 50

  it('四角与中心', () => {
    expect(anchorPosition(canvasW, canvasH, wmW, wmH, 'top-left', 10)).toEqual({ x: 60, y: 35 })
    expect(anchorPosition(canvasW, canvasH, wmW, wmH, 'top-right', 10)).toEqual({ x: 940, y: 35 })
    expect(anchorPosition(canvasW, canvasH, wmW, wmH, 'center', 10)).toEqual({ x: 500, y: 400 })
    expect(anchorPosition(canvasW, canvasH, wmW, wmH, 'bottom-center', 10)).toEqual({
      x: 500,
      y: 765
    })
    expect(anchorPosition(canvasW, canvasH, wmW, wmH, 'middle-left', 10)).toEqual({ x: 60, y: 400 })
  })

  it('水印大于画布时居中，负边距归零', () => {
    expect(anchorPosition(canvasW, canvasH, 1200, 50, 'top-left', 10)).toMatchObject({ x: 500 })
    expect(anchorPosition(canvasW, canvasH, wmW, wmH, 'top-left', -20)).toEqual({ x: 50, y: 25 })
  })
})

describe('平铺', () => {
  it('rotatedBounds 90° 交换宽高', () => {
    const bounds = rotatedBounds(100, 50, 90)
    expect(bounds.width).toBeCloseTo(50)
    expect(bounds.height).toBeCloseTo(100)
  })

  it('按步长铺满并覆盖行列', () => {
    const points = tilePositions(1000, 800, 100, 50, 0)
    // stepX=160, stepY=100 → 6 列 × 8 行
    expect(points).toHaveLength(48)
    expect(points[0]).toEqual({ x: 80, y: 50 })
    expect(points.at(-1)).toEqual({ x: 880, y: 750 })
  })

  it('点数上限截断，非法尺寸返回空数组', () => {
    const points = tilePositions(10_000, 10_000, 1, 1)
    expect(points).toHaveLength(MAX_TILE_POINTS)
    expect(tilePositions(0, 100, 10, 10)).toEqual([])
    expect(tilePositions(100, 100, 0, 10)).toEqual([])
  })
})

describe('命名与编码器', () => {
  it('outputName 保留扩展名并追加 _水印', () => {
    expect(outputName('C:\\imgs\\a.png')).toBe('C:\\imgs\\a_水印.png')
    expect(outputName('/tmp/b.JPEG')).toBe('/tmp/b_水印.JPEG')
    expect(outputName('C:\\imgs\\noext')).toBe('C:\\imgs\\noext_水印')
  })

  it('encoderFor 跟随扩展名', () => {
    expect(encoderFor('a.PNG')).toBe('png')
    expect(encoderFor('a.jpg')).toBe('jpeg')
    expect(encoderFor('a.jpeg')).toBe('jpeg')
    expect(encoderFor('a.webp')).toBe('webp')
    expect(encoderFor('a.gif')).toBeNull()
    expect(encoderFor('noext')).toBeNull()
  })
})
