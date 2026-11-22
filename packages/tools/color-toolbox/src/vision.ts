/**
 * @file 色觉缺陷模拟：8 类 CVD（色觉缺陷）3×3 矩阵与 sRGB 线性空间仿真纯函数
 * @author cuilanchao
 * @date 2026-11-22
 * @description 契约见 docs/spec/color-toolbox.md「M55 追加节」；无副作用、不依赖 DOM/Node。
 *              矩阵来源：Viénot/Brettel/Machado 常用二色觉与异常三色觉近似系数，
 *              作用前先将 sRGB 转为线性 RGB，矩阵运算后再转回 sRGB。
 */

import type { Rgb } from './color'

/** 支持的色觉缺陷类型（8 类） */
export type VisionDeficiencyId =
  | 'protanomaly'
  | 'protanopia'
  | 'deuteranomaly'
  | 'deuteranopia'
  | 'tritanomaly'
  | 'tritanopia'
  | 'achromatopsia'
  | 'achromatomaly'

/** 3×3 矩阵（行优先） */
type Matrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number]
]

/** 色觉缺陷定义 */
export interface VisionDeficiency {
  readonly id: VisionDeficiencyId
  readonly name: string
}

/** 红色盲（protanopia，severity 1.0） */
const PROTANOPIA_MATRIX: Matrix3 = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998]
]

/** 绿色盲（deuteranopia，severity 1.0） */
const DEUTERANOPIA_MATRIX: Matrix3 = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881]
]

/** 蓝黄色盲（tritanopia，severity 1.0） */
const TRITANOPIA_MATRIX: Matrix3 = [
  [1.255528, -0.076749, -0.178779],
  [-0.078411, 0.212726, 0.865685],
  [0.004733, 0.650691, 0.344576]
]

/** 红色弱（protanomaly，severity 0.6） */
const PROTANOMALY_MATRIX: Matrix3 = [
  [0.458064, 0.679578, -0.137642],
  [0.092785, 0.846313, 0.060902],
  [-0.007494, -0.016807, 1.024301]
]

/** 绿色弱（deuteranomaly，severity 0.6） */
const DEUTERANOMALY_MATRIX: Matrix3 = [
  [0.498864, 0.674741, -0.173604],
  [0.205199, 0.754872, 0.039929],
  [-0.011131, 0.030969, 0.980162]
]

/** 蓝黄色弱（tritanomaly，severity 0.6） */
const TRITANOMALY_MATRIX: Matrix3 = [
  [1.017771, 0.048768, -0.06654],
  [0.011921, 0.806491, 0.181588],
  [-0.003275, 0.219139, 0.784136]
]

/** 全色盲（achromatopsia）：线性 RGB 亮度权重三行相同 */
const ACHROMATOPSIA_MATRIX: Matrix3 = [
  [0.2126, 0.7152, 0.0722],
  [0.2126, 0.7152, 0.0722],
  [0.2126, 0.7152, 0.0722]
]

/** 全色弱（achromatomaly）：正常矩阵与全色盲矩阵按 40% / 60% 插值 */
const ACHROMATOMALY_MATRIX: Matrix3 = [
  [0.52756, 0.42912, 0.04332],
  [0.12756, 0.82912, 0.04332],
  [0.12756, 0.42912, 0.44332]
]

/** 8 类色觉缺陷矩阵（id → 矩阵） */
const VISION_MATRICES: Readonly<Record<VisionDeficiencyId, Matrix3>> = {
  protanomaly: PROTANOMALY_MATRIX,
  protanopia: PROTANOPIA_MATRIX,
  deuteranomaly: DEUTERANOMALY_MATRIX,
  deuteranopia: DEUTERANOPIA_MATRIX,
  tritanomaly: TRITANOMALY_MATRIX,
  tritanopia: TRITANOPIA_MATRIX,
  achromatopsia: ACHROMATOPSIA_MATRIX,
  achromatomaly: ACHROMATOMALY_MATRIX
}

/** 8 类色觉缺陷清单（UI 下拉顺序） */
export const VISION_DEFICIENCIES: readonly VisionDeficiency[] = [
  { id: 'protanomaly', name: '红色弱' },
  { id: 'protanopia', name: '红色盲' },
  { id: 'deuteranomaly', name: '绿色弱' },
  { id: 'deuteranopia', name: '绿色盲' },
  { id: 'tritanomaly', name: '蓝黄色弱' },
  { id: 'tritanopia', name: '蓝黄色盲' },
  { id: 'achromatopsia', name: '全色盲' },
  { id: 'achromatomaly', name: '全色弱' }
]

/** 8 位通道 → 线性 RGB（sRGB 传输函数） */
function srgbToLinear(channel: number): number {
  const value = Math.min(255, Math.max(0, channel)) / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** 线性 RGB → 8 位通道（sRGB 传输函数） */
function linearToSrgb(value: number): number {
  const clamped = Math.min(1, Math.max(0, value))
  const encoded =
    clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055
  return Math.min(255, Math.max(0, Math.round(encoded * 255)))
}

/**
 * 按指定色觉缺陷模拟颜色
 * @param rgb 原始颜色（sRGB 8 位）
 * @param id 色觉缺陷类型
 * @returns 模拟后的 sRGB 8 位颜色（不修改入参）
 */
export function simulateColor(rgb: Rgb, id: VisionDeficiencyId): Rgb {
  const matrix = VISION_MATRICES[id]
  const r = srgbToLinear(rgb.r)
  const g = srgbToLinear(rgb.g)
  const b = srgbToLinear(rgb.b)
  return {
    r: linearToSrgb(matrix[0][0] * r + matrix[0][1] * g + matrix[0][2] * b),
    g: linearToSrgb(matrix[1][0] * r + matrix[1][1] * g + matrix[1][2] * b),
    b: linearToSrgb(matrix[2][0] * r + matrix[2][1] * g + matrix[2][2] * b)
  }
}
