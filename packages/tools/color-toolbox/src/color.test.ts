import { describe, expect, it } from 'vitest'

import {
  DEFAULT_COLOR,
  contrastRatio,
  formatColor,
  generateScale,
  harmonies,
  hslToRgb,
  mix,
  parseColor,
  parseHex,
  parseHsl,
  parseRgb,
  randomColor,
  relativeLuminance,
  rgbToHex,
  rgbToHsl,
  rotateHue,
  wcagVerdict,
  type Rgb
} from './color'

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }

function expectRgbClose(actual: Rgb, expected: Rgb): void {
  expect(actual.r).toBeGreaterThanOrEqual(expected.r - 1)
  expect(actual.r).toBeLessThanOrEqual(expected.r + 1)
  expect(actual.g).toBeGreaterThanOrEqual(expected.g - 1)
  expect(actual.g).toBeLessThanOrEqual(expected.g + 1)
  expect(actual.b).toBeGreaterThanOrEqual(expected.b - 1)
  expect(actual.b).toBeLessThanOrEqual(expected.b + 1)
}

describe('parseHex', () => {
  it('解析 6 位与 3 位 HEX（# 可省、大小写不敏感）', () => {
    expect(parseHex('#3B82F6')).toEqual(DEFAULT_COLOR)
    expect(parseHex('3b82f6')).toEqual(DEFAULT_COLOR)
    expect(parseHex('#fff')).toEqual(WHITE)
    expect(parseHex('  #0f0  ')).toEqual({ r: 0, g: 255, b: 0 })
  })

  it('非法输入返回 null', () => {
    expect(parseHex('')).toBeNull()
    expect(parseHex('#12345')).toBeNull()
    expect(parseHex('#GGGGGG')).toBeNull()
    expect(parseHex('rgb(0,0,0)')).toBeNull()
  })
})

describe('parseRgb', () => {
  it('接受包裹与裸值两种写法', () => {
    expect(parseRgb('rgb(59, 130, 246)')).toEqual(DEFAULT_COLOR)
    expect(parseRgb('rgba(59, 130, 246)')).toEqual(DEFAULT_COLOR)
    expect(parseRgb('59 130 246')).toEqual(DEFAULT_COLOR)
    expect(parseRgb('59,130,246')).toEqual(DEFAULT_COLOR)
  })

  it('分量取整并 clamp 到 0–255', () => {
    expect(parseRgb('59.4, 130.6, 245.5')).toEqual({ r: 59, g: 131, b: 246 })
  })

  it('越界、非数、段数不符返回 null', () => {
    expect(parseRgb('300, 0, 0')).toBeNull()
    expect(parseRgb('-1, 0, 0')).toBeNull()
    expect(parseRgb('a, b, c')).toBeNull()
    expect(parseRgb('1, 2')).toBeNull()
    expect(parseRgb('1, 2, 3, 4')).toBeNull()
  })
})

describe('parseHsl', () => {
  it('接受包裹与裸值，% 可省', () => {
    expect(parseHsl('hsl(217, 91%, 60%)')).toEqual({ h: 217, s: 91, l: 60 })
    expect(parseHsl('217, 91, 60')).toEqual({ h: 217, s: 91, l: 60 })
  })

  it('色相取模归一，超范围 s/l 返回 null', () => {
    expect(parseHsl('360, 100, 50')).toEqual({ h: 0, s: 100, l: 50 })
    expect(parseHsl('400, 100, 50')).toEqual({ h: 40, s: 100, l: 50 })
    expect(parseHsl('217, 120, 50')).toBeNull()
    expect(parseHsl('217, -1, 50')).toBeNull()
  })

  it('非数或段数不符返回 null', () => {
    expect(parseHsl('a, 1, 2')).toBeNull()
    expect(parseHsl('217, 91')).toBeNull()
  })
})

describe('parseColor', () => {
  it('按格式分派并归一为 RGB', () => {
    expect(parseColor('#3B82F6', 'hex')).toEqual(DEFAULT_COLOR)
    expect(parseColor('rgb(59, 130, 246)', 'rgb')).toEqual(DEFAULT_COLOR)
    expect(parseColor('hsl(0, 100%, 50%)', 'hsl')).toEqual({ r: 255, g: 0, b: 0 })
    expect(parseColor('nope', 'hex')).toBeNull()
  })
})

describe('rgbToHex / formatColor', () => {
  it('输出大写 #RRGGBB 并 clamp 分量', () => {
    expect(rgbToHex(DEFAULT_COLOR)).toBe('#3B82F6')
    expect(rgbToHex({ r: 300, g: -20, b: 0 })).toBe('#FF0000')
  })

  it('三种格式串', () => {
    expect(formatColor(DEFAULT_COLOR, 'hex')).toBe('#3B82F6')
    expect(formatColor(DEFAULT_COLOR, 'rgb')).toBe('rgb(59, 130, 246)')
    expect(formatColor(DEFAULT_COLOR, 'hsl')).toBe('hsl(217, 91%, 60%)')
  })
})

describe('HSL 互转', () => {
  it('rgbToHsl 主色', () => {
    const hsl = rgbToHsl(DEFAULT_COLOR)
    expect(hsl.h).toBeCloseTo(217.24, 1)
    expect(hsl.s).toBeCloseTo(91.22, 1)
    expect(hsl.l).toBeCloseTo(59.8, 1)
  })

  it('hslToRgb 基色与灰度', () => {
    expect(hslToRgb({ h: 0, s: 100, l: 50 })).toEqual({ r: 255, g: 0, b: 0 })
    expect(hslToRgb({ h: 120, s: 100, l: 50 })).toEqual({ r: 0, g: 255, b: 0 })
    expect(hslToRgb({ h: 240, s: 100, l: 50 })).toEqual({ r: 0, g: 0, b: 255 })
    expect(hslToRgb({ h: -120, s: 100, l: 50 })).toEqual({ r: 0, g: 0, b: 255 })
    expect(hslToRgb({ h: 0, s: 0, l: 0 })).toEqual(BLACK)
    expect(hslToRgb({ h: 0, s: 0, l: 100 })).toEqual(WHITE)
  })

  it('往返误差 ≤1', () => {
    const fixtures: Rgb[] = [
      DEFAULT_COLOR,
      { r: 239, g: 68, b: 68 },
      { r: 34, g: 197, b: 94 },
      { r: 245, g: 158, b: 11 },
      { r: 139, g: 92, b: 246 },
      BLACK,
      WHITE,
      { r: 128, g: 128, b: 128 }
    ]
    for (const fixture of fixtures) {
      expectRgbClose(hslToRgb(rgbToHsl(fixture)), fixture)
    }
  })
})

describe('亮度与对比度', () => {
  it('相对亮度：白 1 / 黑 0', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5)
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5)
    expect(relativeLuminance(DEFAULT_COLOR)).toBeCloseTo(0.2355, 3)
  })

  it('黑白对比度 21，同色 1', () => {
    expect(contrastRatio(WHITE, BLACK)).toBe(21)
    expect(contrastRatio(DEFAULT_COLOR, DEFAULT_COLOR)).toBe(1)
  })

  it('主色 vs 白底 = 3.68', () => {
    expect(contrastRatio(DEFAULT_COLOR, WHITE)).toBe(3.68)
  })
})

describe('wcagVerdict', () => {
  it('正文阈值 7 / 4.5', () => {
    expect(wcagVerdict(21)).toBe('AAA')
    expect(wcagVerdict(7)).toBe('AAA')
    expect(wcagVerdict(6.99)).toBe('AA')
    expect(wcagVerdict(4.5)).toBe('AA')
    expect(wcagVerdict(4.49)).toBe('FAIL')
  })

  it('大字阈值 4.5 / 3', () => {
    expect(wcagVerdict(4.5, true)).toBe('AAA')
    expect(wcagVerdict(4.49, true)).toBe('AA')
    expect(wcagVerdict(3, true)).toBe('AA')
    expect(wcagVerdict(2.99, true)).toBe('FAIL')
  })
})

describe('mix / generateScale', () => {
  it('权重 0 取基色、1 取目标色，越界 clamp', () => {
    expect(mix(DEFAULT_COLOR, WHITE, 0)).toEqual(DEFAULT_COLOR)
    expect(mix(DEFAULT_COLOR, BLACK, 1)).toEqual(BLACK)
    expect(mix(DEFAULT_COLOR, BLACK, 2)).toEqual(BLACK)
    expect(mix(DEFAULT_COLOR, WHITE, -1)).toEqual(DEFAULT_COLOR)
  })

  it('色阶 10 色，第 6 个为主色，两端更浅/更深', () => {
    const scale = generateScale(DEFAULT_COLOR)
    expect(scale).toHaveLength(10)
    expect(scale[5]).toEqual(DEFAULT_COLOR)
    const baseLuminance = relativeLuminance(DEFAULT_COLOR)
    const first = scale[0]
    const last = scale[9]
    expect(first).toBeDefined()
    expect(last).toBeDefined()
    if (first === undefined || last === undefined) return
    expect(relativeLuminance(first)).toBeGreaterThan(baseLuminance)
    expect(relativeLuminance(last)).toBeLessThan(baseLuminance)
  })
})

describe('rotateHue / harmonies', () => {
  it('旋转 360 还原、互补色相 +180', () => {
    expectRgbClose(rotateHue(DEFAULT_COLOR, 360), DEFAULT_COLOR)
    expectRgbClose(rotateHue(rotateHue(DEFAULT_COLOR, 180), 180), DEFAULT_COLOR)
    const complement = rotateHue(DEFAULT_COLOR, 180)
    expect(rgbToHsl(complement).h).toBeCloseTo(37.24, 1)
  })

  it('四组方案顺序与色数', () => {
    const schemes = harmonies(DEFAULT_COLOR)
    expect(schemes.map((scheme) => scheme.id)).toEqual([
      'complementary',
      'analogous',
      'triadic',
      'split'
    ])
    expect(schemes.map((scheme) => scheme.name)).toEqual([
      '互补色',
      '类似色',
      '三角配色',
      '分裂互补'
    ])
    expect(schemes.map((scheme) => scheme.colors.length)).toEqual([2, 3, 3, 3])
    const analogous = schemes[1]
    expect(analogous?.colors[1]).toEqual(DEFAULT_COLOR)
  })
})

describe('randomColor', () => {
  it('注入随机源可复现，且上界 clamp 到 255', () => {
    const values = [0, 0.5, 1]
    let index = 0
    const random = (): number => {
      const value = values[index % values.length] ?? 0
      index += 1
      return value
    }
    expect(randomColor(random)).toEqual({ r: 0, g: 128, b: 255 })
  })
})
