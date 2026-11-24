/**
 * @file contract.test.ts 区域归一/坐标换算/命名/编码器纯函数单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖越界收敛、最小尺寸、上限截断、草图归一、平移夹取、百分比定位与扩展名映射
 */
import { describe, expect, it } from 'vitest'
import {
  clampRegion,
  encoderFor,
  expandRegion,
  isRegionOversized,
  moveRegion,
  normalizeDraftRegion,
  normalizeRegions,
  outputName,
  readChannel,
  rectToPercent,
  regionArea,
  toImagePoint
} from './contract'
import { MAX_REGIONS } from './schema'

describe('clampRegion', () => {
  it('取整并夹取到图像内', () => {
    expect(clampRegion({ x: 9.6, y: -3, width: 20, height: 10.2 }, 100, 100)).toEqual({
      x: 10,
      y: 0,
      width: 20,
      height: 7
    })
  })

  it('图像尺寸非法或区域过小返回 null', () => {
    expect(clampRegion({ x: 0, y: 0, width: 10, height: 10 }, 0, 100)).toBeNull()
    expect(clampRegion({ x: 0, y: 0, width: 1, height: 10 }, 100, 100)).toBeNull()
    expect(clampRegion({ x: 100, y: 100, width: 10, height: 10 }, 100, 100)).toBeNull()
  })
})

describe('normalizeRegions', () => {
  it('丢弃非法并截断到上限', () => {
    const regions = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 200, y: 200, width: 10, height: 10 },
      { x: 1, y: 1, width: 10, height: 10 },
      { x: 2, y: 2, width: 10, height: 10 }
    ]
    expect(normalizeRegions(regions, 100, 100, 2)).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 1, y: 1, width: 10, height: 10 }
    ])
  })

  it('默认上限为 20', () => {
    const regions = Array.from({ length: 30 }, (_, index) => ({
      x: index,
      y: index,
      width: 4,
      height: 4
    }))
    expect(normalizeRegions(regions, 100, 100)).toHaveLength(MAX_REGIONS)
  })
})

describe('expandRegion / regionArea / isRegionOversized', () => {
  it('外扩并夹取在图像内', () => {
    expect(expandRegion({ x: 1, y: 1, width: 4, height: 4 }, 4, 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 9,
      height: 9
    })
    expect(expandRegion({ x: 96, y: 96, width: 4, height: 4 }, 10, 100, 100)).toEqual({
      x: 86,
      y: 86,
      width: 14,
      height: 14
    })
  })

  it('面积与超限判定', () => {
    expect(regionArea({ x: 0, y: 0, width: 10, height: 5 })).toBe(50)
    expect(isRegionOversized({ x: 0, y: 0, width: 10, height: 5 })).toBe(false)
    expect(isRegionOversized({ x: 0, y: 0, width: 2000, height: 1001 })).toBe(true)
    expect(isRegionOversized({ x: 0, y: 0, width: 10, height: 10 }, 50)).toBe(true)
  })
})

describe('normalizeDraftRegion', () => {
  it('反向拖拽也得到正矩形', () => {
    expect(normalizeDraftRegion({ x: 30, y: 40 }, { x: 10, y: 20 }, 100, 100)).toEqual({
      x: 10,
      y: 20,
      width: 20,
      height: 20
    })
  })

  it('过小或越界被夹取/丢弃', () => {
    expect(normalizeDraftRegion({ x: 10, y: 10 }, { x: 10.5, y: 10.5 }, 100, 100)).toBeNull()
    expect(normalizeDraftRegion({ x: 95, y: 95 }, { x: 200, y: 200 }, 100, 100)).toEqual({
      x: 95,
      y: 95,
      width: 5,
      height: 5
    })
  })
})

describe('moveRegion', () => {
  it('平移并在边界夹取', () => {
    expect(moveRegion({ x: 10, y: 10, width: 20, height: 20 }, 5, -3, 100, 100)).toEqual({
      x: 15,
      y: 7,
      width: 20,
      height: 20
    })
    expect(moveRegion({ x: 90, y: 90, width: 20, height: 20 }, 50, 50, 100, 100)).toEqual({
      x: 80,
      y: 80,
      width: 20,
      height: 20
    })
  })

  it('区域大于图片时贴左上', () => {
    expect(moveRegion({ x: 0, y: 0, width: 200, height: 200 }, 10, 10, 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 200
    })
  })
})

describe('toImagePoint / rectToPercent', () => {
  it('显示坐标按比例映射并夹取', () => {
    expect(
      toImagePoint({ x: 50, y: 25 }, { width: 100, height: 100 }, { width: 400, height: 200 })
    ).toEqual({ x: 200, y: 50 })
    expect(
      toImagePoint({ x: -5, y: 999 }, { width: 100, height: 100 }, { width: 400, height: 200 })
    ).toEqual({ x: 0, y: 200 })
    expect(
      toImagePoint({ x: 1, y: 1 }, { width: 0, height: 0 }, { width: 10, height: 10 })
    ).toEqual({ x: 0, y: 0 })
  })

  it('矩形转百分比并夹取', () => {
    expect(
      rectToPercent({ x: 25, y: 50, width: 50, height: 25 }, { width: 100, height: 200 })
    ).toEqual({ left: 25, top: 25, width: 50, height: 12.5 })
    expect(rectToPercent({ x: 10, y: 10, width: 10, height: 10 }, { width: 0, height: 0 })).toEqual(
      {
        left: 0,
        top: 0,
        width: 0,
        height: 0
      }
    )
  })
})

describe('outputName / encoderFor', () => {
  it('保留原扩展名并追加后缀', () => {
    expect(outputName('C:/imgs/a.png')).toBe('C:/imgs/a_去水印.png')
    expect(outputName('a.jpeg')).toBe('a_去水印.jpeg')
    expect(outputName('noext')).toBe('noext_去水印')
  })

  it('扩展名映射编码器', () => {
    expect(encoderFor('a.png')).toBe('png')
    expect(encoderFor('a.JPG')).toBe('jpeg')
    expect(encoderFor('a.jpeg')).toBe('jpeg')
    expect(encoderFor('a.webp')).toBe('webp')
    expect(encoderFor('a.gif')).toBeNull()
    expect(encoderFor('a')).toBeNull()
  })
})

describe('readChannel', () => {
  it('范围内取值；越界按 0（noUncheckedIndexedAccess 兜底）', () => {
    expect(readChannel(new Uint8ClampedArray([7, 8, 9]), 1)).toBe(8)
    expect(readChannel(new Uint8ClampedArray(0), 0)).toBe(0)
    expect(readChannel(new Float32Array([1.5]), 0)).toBe(1.5)
  })
})
