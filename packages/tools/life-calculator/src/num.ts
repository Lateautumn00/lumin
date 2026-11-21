/**
 * @file 金额/比率数值工具（工具内部共用，不跨工具）
 * @author cuilanchao
 * @date 2026-11-21
 */

/** 保留两位小数（金额展示口径；先加 EPSILON 抵消浮点下溢） */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** 有限数字判定：排除 NaN / ±Infinity / 空值 */
export function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
