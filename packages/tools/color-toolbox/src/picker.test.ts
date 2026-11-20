/**
 * @file picker.ts 坐标映射单测（点击位置 → 截图原始像素）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'

import { mapPointToPixel } from './picker'

const RECT = { left: 10, top: 20, width: 100, height: 50 }
const SIZE = { width: 400, height: 200 }

describe('mapPointToPixel', () => {
  it('按矩形与尺寸比例换算（左上角 → 0,0）', () => {
    expect(mapPointToPixel({ x: 10, y: 20 }, RECT, SIZE)).toEqual({ x: 0, y: 0 })
  })

  it('按比例换算（中心与右下区域）', () => {
    expect(mapPointToPixel({ x: 60, y: 45 }, RECT, SIZE)).toEqual({ x: 200, y: 100 })
    expect(mapPointToPixel({ x: 109, y: 69 }, RECT, SIZE)).toEqual({ x: 396, y: 196 })
  })

  it('矩形外/负偏移返回 null', () => {
    expect(mapPointToPixel({ x: 9, y: 20 }, RECT, SIZE)).toBeNull()
    expect(mapPointToPixel({ x: 10, y: 19 }, RECT, SIZE)).toBeNull()
    expect(mapPointToPixel({ x: 110, y: 20 }, RECT, SIZE)).toBeNull()
    expect(mapPointToPixel({ x: 10, y: 70 }, RECT, SIZE)).toBeNull()
  })

  it('无效矩形或尺寸返回 null', () => {
    expect(mapPointToPixel({ x: 10, y: 20 }, { ...RECT, width: 0 }, SIZE)).toBeNull()
    expect(mapPointToPixel({ x: 10, y: 20 }, { ...RECT, height: 0 }, SIZE)).toBeNull()
    expect(mapPointToPixel({ x: 10, y: 20 }, RECT, { width: 0, height: 200 })).toBeNull()
    expect(mapPointToPixel({ x: 10, y: 20 }, RECT, { width: 400, height: 0 })).toBeNull()
  })

  it('1×1 截图恒为 0,0', () => {
    expect(mapPointToPixel({ x: 10, y: 20 }, RECT, { width: 1, height: 1 })).toEqual({ x: 0, y: 0 })
  })
})
