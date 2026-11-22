/**
 * @file ruler.ts 单测：矩形归一化、DPI 校验、像素换算与摘要
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DPI,
  MAX_DPI,
  MIN_DPI,
  isValidDpi,
  measureRect,
  normalizeRect,
  pxToCm,
  pxToInch,
  rulerSummary
} from './ruler'

describe('isValidDpi', () => {
  it('接受 48–600 的有限数', () => {
    expect(isValidDpi(MIN_DPI)).toBe(true)
    expect(isValidDpi(DEFAULT_DPI)).toBe(true)
    expect(isValidDpi(MAX_DPI)).toBe(true)
  })

  it('拒绝越界 / 非数 / 空值', () => {
    expect(isValidDpi(MIN_DPI - 1)).toBe(false)
    expect(isValidDpi(MAX_DPI + 1)).toBe(false)
    expect(isValidDpi(Number.NaN)).toBe(false)
    expect(isValidDpi(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isValidDpi(null)).toBe(false)
    expect(isValidDpi(undefined)).toBe(false)
  })
})

describe('normalizeRect', () => {
  it('右下拖拽', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 110, y: 70 })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50
    })
  })

  it('左上反向拖拽也归一化为非负宽高', () => {
    expect(normalizeRect({ x: 110, y: 70 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50
    })
  })

  it('小数坐标四舍五入', () => {
    expect(normalizeRect({ x: 0.4, y: 10.6 }, { x: 100.4, y: 60.2 })).toEqual({
      x: 0,
      y: 11,
      width: 100,
      height: 50
    })
  })
})

describe('pxToCm / pxToInch', () => {
  it('96 DPI 下 96px = 1in = 2.54cm', () => {
    expect(pxToCm(96, 96)).toBeCloseTo(2.54)
    expect(pxToInch(96, 96)).toBeCloseTo(1)
  })

  it('按 DPI 线性缩放', () => {
    expect(pxToCm(192, 192)).toBeCloseTo(2.54)
    expect(pxToInch(600, 300)).toBeCloseTo(2)
  })
})

describe('measureRect', () => {
  it('1920×1080 @96DPI / 缩放 2 的完整换算', () => {
    const metrics = measureRect({ x: 0, y: 0, width: 1920, height: 1080 }, 96, 2)
    expect(metrics.widthPx).toBe(1920)
    expect(metrics.heightPx).toBe(1080)
    expect(metrics.diagonalPx).toBe(2203)
    expect(metrics.widthLogicalPx).toBe(960)
    expect(metrics.heightLogicalPx).toBe(540)
    expect(metrics.widthCm).toBe(50.8)
    expect(metrics.heightCm).toBe(28.58)
    expect(metrics.widthIn).toBe(20)
    expect(metrics.heightIn).toBe(11.25)
    expect(metrics.diagonalCm).toBe(58.29)
    expect(metrics.diagonalIn).toBe(22.95)
  })

  it('无效 DPI / 缩放回退默认值', () => {
    const fallback = measureRect({ x: 0, y: 0, width: 96, height: 96 }, Number.NaN, 0)
    expect(fallback.widthCm).toBe(2.54)
    expect(fallback.widthLogicalPx).toBe(96)
  })

  it('零尺寸返回全 0（不产生 NaN）', () => {
    const metrics = measureRect({ x: 5, y: 5, width: 0, height: 0 }, 96, 1)
    expect(metrics).toEqual({
      widthPx: 0,
      heightPx: 0,
      diagonalPx: 0,
      widthLogicalPx: 0,
      heightLogicalPx: 0,
      widthCm: 0,
      heightCm: 0,
      diagonalCm: 0,
      widthIn: 0,
      heightIn: 0,
      diagonalIn: 0
    })
  })
})

describe('rulerSummary', () => {
  it('包含宽高对角线三条文本', () => {
    const summary = rulerSummary(measureRect({ x: 0, y: 0, width: 960, height: 540 }, 96, 1))
    expect(summary.split('\n')).toHaveLength(4)
    expect(summary).toContain('宽 960 px / 25.4 cm / 10 in')
    expect(summary).toContain('高 540 px / 14.29 cm / 5.63 in')
    expect(summary).toContain('对角线 1101 px')
    expect(summary).toContain('逻辑尺寸 960 × 540 px')
  })
})
