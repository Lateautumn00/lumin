import { describe, expect, it } from 'vitest'

import type { Rgb } from './color'
import { VISION_DEFICIENCIES, simulateColor, type VisionDeficiencyId } from './vision'

const BLACK: Rgb = { r: 0, g: 0, b: 0 }
const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const GRAY: Rgb = { r: 128, g: 128, b: 128 }
const RED: Rgb = { r: 255, g: 0, b: 0 }

/** 红色在各缺陷下的回归向量（线性 RGB 矩阵 + sRGB 往返） */
const RED_VECTORS: Readonly<Record<VisionDeficiencyId, Rgb>> = {
  protanomaly: { r: 180, g: 86, b: 0 },
  protanopia: { r: 109, g: 95, b: 0 },
  deuteranomaly: { r: 187, g: 125, b: 0 },
  deuteranopia: { r: 163, g: 144, b: 0 },
  tritanomaly: { r: 255, g: 28, b: 0 },
  tritanopia: { r: 255, g: 0, b: 15 },
  achromatopsia: { r: 127, g: 127, b: 127 },
  achromatomaly: { r: 192, g: 100, b: 100 }
}

describe('VISION_DEFICIENCIES', () => {
  it('包含 8 类且 id 唯一、名称非空', () => {
    expect(VISION_DEFICIENCIES).toHaveLength(8)
    const ids = new Set(VISION_DEFICIENCIES.map((item) => item.id))
    expect(ids.size).toBe(8)
    for (const item of VISION_DEFICIENCIES) {
      expect(item.name.length).toBeGreaterThan(0)
      expect(RED_VECTORS[item.id]).toBeDefined()
    }
  })
})

describe('simulateColor', () => {
  it('黑/白/中性灰在 8 类缺陷下保持不变', () => {
    for (const { id } of VISION_DEFICIENCIES) {
      expect(simulateColor(BLACK, id)).toEqual(BLACK)
      expect(simulateColor(WHITE, id)).toEqual(WHITE)
      expect(simulateColor(GRAY, id)).toEqual(GRAY)
    }
  })

  it('每类缺陷的红色回归向量稳定', () => {
    for (const { id } of VISION_DEFICIENCIES) {
      expect(simulateColor(RED, id)).toEqual(RED_VECTORS[id])
    }
  })

  it('全色盲输出三通道相等', () => {
    const simulated = simulateColor(RED, 'achromatopsia')
    expect(simulated.r).toBe(simulated.g)
    expect(simulated.g).toBe(simulated.b)
  })

  it('输出始终在 0–255 且不修改入参', () => {
    const input: Rgb = { r: 300, g: -10, b: 128 }
    const snapshot = { ...input }
    for (const { id } of VISION_DEFICIENCIES) {
      const simulated = simulateColor(input, id)
      for (const channel of [simulated.r, simulated.g, simulated.b]) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(255)
        expect(Number.isInteger(channel)).toBe(true)
      }
    }
    expect(input).toEqual(snapshot)
  })

  it('同色重复调用结果稳定', () => {
    expect(simulateColor(RED, 'deuteranopia')).toEqual(simulateColor(RED, 'deuteranopia'))
  })
})
