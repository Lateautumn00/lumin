/**
 * @file contract.test.ts 布局纯函数断言（spec §4）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import {
  baseExtent,
  clampInt,
  extForEncoder,
  fitInBox,
  MAX_CANVAS_EDGE,
  MAX_CANVAS_PIXELS,
  MAX_SPLIT_SLICES,
  outputFileName,
  planLayout,
  planOverLimit,
  planSplit,
  scaleToHeight,
  scaleToWidth,
  splitFileName,
  timestampName,
  type LayoutPlan
} from './contract'
import type { LayoutOptions } from './schema'

function layout(overrides: Partial<LayoutOptions> = {}): LayoutOptions {
  return {
    mode: 'vertical',
    sizeMode: 'first',
    fixedSize: 2000,
    columns: 3,
    gutter: 0,
    padding: 0,
    ...overrides
  }
}

function mustPlan(plan: LayoutPlan | null): LayoutPlan {
  if (plan === null) throw new Error('期望布局有效')
  return plan
}

describe('clampInt', () => {
  it('取整并夹取上下界', () => {
    expect(clampInt(3.6, 0, 10)).toBe(4)
    expect(clampInt(-5, 0, 10)).toBe(0)
    expect(clampInt(99, 0, 10)).toBe(10)
  })

  it('非有限值归下界', () => {
    expect(clampInt(Number.NaN, 2, 8)).toBe(2)
    expect(clampInt(Number.POSITIVE_INFINITY, 2, 8)).toBe(2)
  })
})

describe('等比缩放', () => {
  it('scaleToWidth 保持比例且高度至少 1px', () => {
    expect(scaleToWidth(200, 100, 50)).toEqual({ width: 50, height: 25 })
    expect(scaleToWidth(1000, 1, 10)).toEqual({ width: 10, height: 1 })
  })

  it('scaleToHeight 保持比例且宽度至少 1px', () => {
    expect(scaleToHeight(100, 200, 50)).toEqual({ width: 25, height: 50 })
    expect(scaleToHeight(1, 1000, 10)).toEqual({ width: 1, height: 10 })
  })

  it('fitInBox 取较小比例 contain', () => {
    expect(fitInBox(100, 50, 50, 50)).toEqual({ width: 50, height: 25 })
    expect(fitInBox(50, 100, 50, 50)).toEqual({ width: 25, height: 50 })
    expect(fitInBox(40, 40, 100, 100)).toEqual({ width: 40, height: 40 })
  })

  it('非法入参返回 null', () => {
    expect(scaleToWidth(0, 10, 10)).toBeNull()
    expect(scaleToHeight(10, 0, 10)).toBeNull()
    expect(fitInBox(10, 10, 0, 10)).toBeNull()
  })
})

describe('baseExtent', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 300, height: 20 }
  ]

  it('首图 / 最大 / 固定', () => {
    expect(baseExtent(sizes, 'first', 999, 'width')).toBe(100)
    expect(baseExtent(sizes, 'max', 999, 'width')).toBe(300)
    expect(baseExtent(sizes, 'max', 999, 'height')).toBe(50)
    expect(baseExtent(sizes, 'fixed', 640, 'width')).toBe(640)
  })

  it('无图 / 固定值非法返回 null', () => {
    expect(baseExtent([], 'first', 640, 'width')).toBeNull()
    expect(baseExtent(sizes, 'fixed', 0, 'width')).toBeNull()
    expect(baseExtent([{ width: 0, height: 0 }], 'max', 640, 'width')).toBeNull()
  })
})

describe('planLayout 纵向', () => {
  it('统一宽度、间距与外边距累加', () => {
    const plan = mustPlan(
      planLayout(
        [
          { width: 100, height: 50 },
          { width: 200, height: 100 }
        ],
        layout({ gutter: 10, padding: 5 })
      )
    )
    expect(plan.width).toBe(110)
    expect(plan.height).toBe(5 + 50 + 10 + 50 + 5)
    expect(plan.placements).toEqual([
      { x: 5, y: 5, width: 100, height: 50 },
      { x: 5, y: 65, width: 100, height: 50 }
    ])
  })

  it('fixed 基准宽度生效', () => {
    const plan = mustPlan(
      planLayout([{ width: 100, height: 100 }], layout({ sizeMode: 'fixed', fixedSize: 300 }))
    )
    expect(plan).toMatchObject({ width: 300 })
    expect(plan.placements[0]).toEqual({ x: 0, y: 0, width: 300, height: 300 })
  })
})

describe('planLayout 横向', () => {
  it('统一高度、自左向右', () => {
    const plan = mustPlan(
      planLayout(
        [
          { width: 100, height: 50 },
          { width: 100, height: 100 }
        ],
        layout({ mode: 'horizontal', sizeMode: 'max', gutter: 4, padding: 2 })
      )
    )
    // base 高度 = 100；第一张缩放到 200×100
    expect(plan.height).toBe(104)
    expect(plan.width).toBe(2 + 200 + 4 + 100 + 2)
    expect(plan.placements).toEqual([
      { x: 2, y: 2, width: 200, height: 100 },
      { x: 206, y: 2, width: 100, height: 100 }
    ])
  })
})

describe('planLayout 网格', () => {
  it('等宽单元格 contain 居中', () => {
    const plan = mustPlan(
      planLayout(
        [
          { width: 100, height: 50 },
          { width: 50, height: 100 },
          { width: 80, height: 80 }
        ],
        layout({ mode: 'grid', columns: 2, gutter: 10, padding: 4 })
      )
    )
    // base = 首图宽 100 → cell = floor((100 - 10) / 2) = 45
    expect(plan.width).toBe(108)
    expect(plan.height).toBe(4 + 45 + 10 + 45 + 4)
    expect(plan.placements[0]).toEqual({ x: 4, y: 4 + 11, width: 45, height: 23 })
    expect(plan.placements[1]).toEqual({ x: 4 + 45 + 10 + 11, y: 4, width: 23, height: 45 })
    expect(plan.placements[2]).toEqual({ x: 4, y: 4 + 45 + 10, width: 45, height: 45 })
  })

  it('单元格小于 1px 返回 null', () => {
    expect(
      planLayout([{ width: 10, height: 10 }], layout({ mode: 'grid', columns: 8, gutter: 10 }))
    ).toBeNull()
  })
})

describe('planLayout 边界', () => {
  it('无图或尺寸非法返回 null', () => {
    expect(planLayout([], layout())).toBeNull()
    expect(planLayout([{ width: 0, height: 10 }], layout())).toBeNull()
  })
})

describe('planOverLimit', () => {
  it('单边与总像素双阈值', () => {
    expect(planOverLimit({ width: MAX_CANVAS_EDGE + 1, height: 10, placements: [] })).toBe(true)
    expect(
      planOverLimit({ width: 20_000, height: MAX_CANVAS_PIXELS / 20_000 + 1, placements: [] })
    ).toBe(true)
    expect(planOverLimit({ width: 1000, height: 1000, placements: [] })).toBe(false)
  })
})

describe('planSplit 固定高度（M40）', () => {
  it('整除与末段余量', () => {
    expect(planSplit(900, 'height', 300)).toEqual({
      slices: [
        { y: 0, h: 300 },
        { y: 300, h: 300 },
        { y: 600, h: 300 }
      ]
    })
    expect(planSplit(1000, 'height', 300)?.slices.map((s) => s.h)).toEqual([300, 300, 300, 100])
  })

  it('非法高度 / 超段数上限 → null', () => {
    expect(planSplit(0, 'height', 300)).toBeNull()
    expect(planSplit(900, 'height', 0)).toBeNull()
    expect(planSplit(MAX_SPLIT_SLICES * 50 + 1, 'height', 50)).toBeNull()
  })
})

describe('planSplit 按份数（M40）', () => {
  it('余数摊到前几段', () => {
    expect(planSplit(91, 'parts', 3)?.slices).toEqual([
      { y: 0, h: 31 },
      { y: 31, h: 30 },
      { y: 61, h: 30 }
    ])
    expect(planSplit(10, 'parts', 4)?.slices.map((s) => s.h)).toEqual([3, 3, 2, 2])
  })

  it('份数超过图高/少于 2/超上限 → null', () => {
    expect(planSplit(10, 'parts', 11)).toBeNull()
    expect(planSplit(10, 'parts', 1)).toBeNull()
    expect(planSplit(1000, 'parts', MAX_SPLIT_SLICES + 1)).toBeNull()
  })

  it('非整数高度与份数向下取整', () => {
    expect(planSplit(100.9, 'height', 50)?.slices.map((s) => s.h)).toEqual([50, 50])
    expect(planSplit(100, 'parts', 3.9)?.slices).toHaveLength(3)
  })
})

describe('splitFileName（M40）', () => {
  it('序号 1 起、补零至少 2 位', () => {
    expect(splitFileName('长 图.png', 1, 3, 'png')).toBe('长 图_part01.png')
    expect(splitFileName('a.jpg', 2, 3, 'jpg')).toBe('a_part02.jpg')
  })

  it('段数 ≥100 时补零到 3 位', () => {
    expect(splitFileName('a.png', 1, 100, 'png')).toBe('a_part001.png')
    expect(splitFileName('a.png', 100, 100, 'png')).toBe('a_part100.png')
  })

  it('无扩展名/非法序号兜底', () => {
    expect(splitFileName('README', 0, 2, 'png')).toBe('README_part01.png')
  })
})

describe('命名', () => {
  const date = new Date(2026, 10, 20, 9, 5, 3)

  it('timestampName 本地时间戳', () => {
    expect(timestampName(date)).toBe('20261120-090503')
  })

  it('outputFileName 前缀与扩展名', () => {
    expect(outputFileName(date, 'png')).toBe('拼接_20261120-090503.png')
  })

  it('extForEncoder 把 jpeg 映射为 jpg', () => {
    expect(extForEncoder('jpeg')).toBe('jpg')
    expect(extForEncoder('png')).toBe('png')
    expect(extForEncoder('webp')).toBe('webp')
  })
})
