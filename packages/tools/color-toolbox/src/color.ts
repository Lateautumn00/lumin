/**
 * @file 颜色转换、色阶 / 调和色生成与 WCAG 2.1 对比度纯函数
 * @author cuilanchao
 * @date 2026-11-20
 * @description 契约见 docs/spec/color-toolbox.md §3；全部函数无副作用、不依赖 DOM/Node
 */

/** 8 位 RGB 颜色（分量 0–255） */
export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** HSL 颜色（h 0–360，s/l 为百分比 0–100；内部保留小数，展示时取整） */
export interface Hsl {
  readonly h: number
  readonly s: number
  readonly l: number
}

/** 输入/输出格式 */
export type ColorFormat = 'hex' | 'rgb' | 'hsl'

/** WCAG 判定档位 */
export type WcagVerdict = 'AAA' | 'AA' | 'FAIL'

/** 调和色方案 */
export interface Harmony {
  readonly id: 'complementary' | 'analogous' | 'triadic' | 'split'
  readonly name: string
  readonly colors: readonly Rgb[]
}

/** 默认主色（蓝 500 #3B82F6） */
export const DEFAULT_COLOR: Rgb = { r: 59, g: 130, b: 246 }

/** 支持的输入格式（顺序与 UI 下拉一致） */
export const COLOR_FORMATS: readonly ColorFormat[] = ['hex', 'rgb', 'hsl']

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** 浅色色阶与白色混合的权重（由浅到深） */
const TINT_WEIGHTS = [0.9, 0.72, 0.54, 0.36, 0.18] as const

/** 深色色阶与黑色混合的权重（由浅到深） */
const SHADE_WEIGHTS = [0.18, 0.36, 0.54, 0.72] as const

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}

/**
 * 解析 HEX 颜色（`#` 可省，支持 3 位缩写）
 * @param input 用户输入
 * @returns 解析失败返回 null
 */
export function parseHex(input: string): Rgb | null {
  const match = HEX_RE.exec(input.trim())
  if (match === null) return null
  const raw = match[1]
  if (raw === undefined) return null
  const hex = raw.length === 3 ? [...raw].map((char) => char + char).join('') : raw
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16)
  }
}

/**
 * 解析 RGB 文本：接受 `rgb(r, g, b)` / `rgba(r, g, b)` 包裹或裸值（逗号/空白分隔）
 * @param input 用户输入
 * @returns 解析失败（分量越界 / 非数 / 不是 3 段）返回 null
 */
export function parseRgb(input: string): Rgb | null {
  const body = input
    .trim()
    .replace(/^rgba?\s*\(/i, '')
    .replace(/\)$/, '')
  const parts = body.split(/[\s,/]+/).filter((part) => part !== '')
  if (parts.length !== 3) return null
  const r = Number(parts[0])
  const g = Number(parts[1])
  const b = Number(parts[2])
  if (![r, g, b].every((value) => Number.isFinite(value) && value >= 0 && value <= 255)) {
    return null
  }
  return { r: clampChannel(r), g: clampChannel(g), b: clampChannel(b) }
}

/**
 * 解析 HSL 文本：接受 `hsl(h, s%, l%)` 包裹或裸值；s/l 的 `%` 可省
 * @param input 用户输入
 * @returns 解析失败返回 null
 */
export function parseHsl(input: string): Hsl | null {
  const body = input
    .trim()
    .replace(/^hsla?\s*\(/i, '')
    .replace(/\)$/, '')
  const parts = body
    .split(/[\s,/]+/)
    .filter((part) => part !== '')
    .map((part) => part.replace(/%$/, ''))
  if (parts.length !== 3) return null
  const h = Number(parts[0])
  const s = Number(parts[1])
  const l = Number(parts[2])
  if (![h, s, l].every((value) => Number.isFinite(value))) return null
  if (s < 0 || s > 100 || l < 0 || l > 100) return null
  const hue = ((h % 360) + 360) % 360
  return { h: hue, s, l }
}

/**
 * 按指定格式解析颜色并归一为 RGB
 * @param input 用户输入
 * @param format 输入格式
 * @returns 解析失败返回 null
 */
export function parseColor(input: string, format: ColorFormat): Rgb | null {
  if (format === 'hex') return parseHex(input)
  if (format === 'rgb') return parseRgb(input)
  const hsl = parseHsl(input)
  return hsl === null ? null : hslToRgb(hsl)
}

/** RGB → `#RRGGBB`（大写） */
export function rgbToHex(rgb: Rgb): string {
  const hex = [rgb.r, rgb.g, rgb.b]
    .map((value) => clampChannel(value).toString(16).padStart(2, '0'))
    .join('')
  return `#${hex.toUpperCase()}`
}

/** RGB → HSL（h 0–360，s/l 0–100，保留精度） */
export function rgbToHsl(rgb: Rgb): Hsl {
  const r = clampChannel(rgb.r) / 255
  const g = clampChannel(rgb.g) / 255
  const b = clampChannel(rgb.b) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: lightness * 100 }
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue: number
  if (max === r) {
    hue = (g - b) / delta + (g < b ? 6 : 0)
  } else if (max === g) {
    hue = (b - r) / delta + 2
  } else {
    hue = (r - g) / delta + 4
  }
  return { h: hue * 60, s: saturation * 100, l: lightness * 100 }
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t
  if (value < 0) value += 1
  if (value > 1) value -= 1
  if (value < 1 / 6) return p + (q - p) * 6 * value
  if (value < 1 / 2) return q
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6
  return p
}

/** HSL → RGB（h 自动取模 360；s/l 越界 clamp 到 0–100） */
export function hslToRgb(hsl: Hsl): Rgb {
  const hue = (((hsl.h % 360) + 360) % 360) / 360
  const saturation = Math.min(100, Math.max(0, hsl.s)) / 100
  const lightness = Math.min(100, Math.max(0, hsl.l)) / 100
  if (saturation === 0) {
    const value = clampChannel(lightness * 255)
    return { r: value, g: value, b: value }
  }
  const q =
    lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  return {
    r: clampChannel(hueToRgb(p, q, hue + 1 / 3) * 255),
    g: clampChannel(hueToRgb(p, q, hue) * 255),
    b: clampChannel(hueToRgb(p, q, hue - 1 / 3) * 255)
  }
}

/**
 * RGB → 指定格式文本
 * @param rgb 颜色
 * @param format 目标格式
 */
export function formatColor(rgb: Rgb, format: ColorFormat): string {
  if (format === 'hex') return rgbToHex(rgb)
  if (format === 'rgb') {
    return `rgb(${clampChannel(rgb.r)}, ${clampChannel(rgb.g)}, ${clampChannel(rgb.b)})`
  }
  const hsl = rgbToHsl(rgb)
  return `hsl(${Math.round(hsl.h)}, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%)`
}

/**
 * WCAG 2.1 相对亮度
 * @param rgb 颜色
 * @returns 0–1
 */
export function relativeLuminance(rgb: Rgb): number {
  const linear = (value: number): number => {
    const channel = clampChannel(value) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
}

/**
 * WCAG 对比度（1–21，保留 2 位小数）
 * @param a 颜色 A
 * @param b 颜色 B
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const luminanceA = relativeLuminance(a)
  const luminanceB = relativeLuminance(b)
  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
}

/**
 * WCAG 判定档位
 * @param ratio 对比度
 * @param largeText 是否为「大字」（≥24px 常规或 ≥18.66px 粗体）
 * @returns 满足的最高档位，均不满足为 FAIL
 */
export function wcagVerdict(ratio: number, largeText = false): WcagVerdict {
  const aaa = largeText ? 4.5 : 7
  const aa = largeText ? 3 : 4.5
  if (ratio >= aaa) return 'AAA'
  if (ratio >= aa) return 'AA'
  return 'FAIL'
}

/**
 * 两色线性混合
 * @param base 基色
 * @param target 目标色
 * @param weight 目标色权重（0–1，越界 clamp）
 */
export function mix(base: Rgb, target: Rgb, weight: number): Rgb {
  const ratio = Math.min(1, Math.max(0, weight))
  return {
    r: clampChannel(base.r * (1 - ratio) + target.r * ratio),
    g: clampChannel(base.g * (1 - ratio) + target.g * ratio),
    b: clampChannel(base.b * (1 - ratio) + target.b * ratio)
  }
}

/**
 * 生成 10 级色阶：5 浅 + 主色 + 4 深
 * @param base 主色
 */
export function generateScale(base: Rgb): Rgb[] {
  return [
    ...TINT_WEIGHTS.map((weight) => mix(base, WHITE, weight)),
    base,
    ...SHADE_WEIGHTS.map((weight) => mix(base, BLACK, weight))
  ]
}

/**
 * 仅旋转 HSL 色相
 * @param rgb 基色
 * @param degrees 旋转角度（可为负）
 */
export function rotateHue(rgb: Rgb, degrees: number): Rgb {
  const hsl = rgbToHsl(rgb)
  return hslToRgb({ h: hsl.h + degrees, s: hsl.s, l: hsl.l })
}

/**
 * 生成四组调和色（顺序：互补 / 类似 / 三角 / 分裂互补）
 * @param base 主色
 */
export function harmonies(base: Rgb): Harmony[] {
  return [
    { id: 'complementary', name: '互补色', colors: [base, rotateHue(base, 180)] },
    {
      id: 'analogous',
      name: '类似色',
      colors: [rotateHue(base, -30), base, rotateHue(base, 30)]
    },
    { id: 'triadic', name: '三角配色', colors: [base, rotateHue(base, 120), rotateHue(base, 240)] },
    {
      id: 'split',
      name: '分裂互补',
      colors: [base, rotateHue(base, 150), rotateHue(base, 210)]
    }
  ]
}

/**
 * 生成随机颜色
 * @param random 随机源（默认 Math.random；单测可注入固定序列）
 */
export function randomColor(random: () => number = Math.random): Rgb {
  const channel = (): number => clampChannel(Math.floor(random() * 256))
  return { r: channel(), g: channel(), b: channel() }
}
