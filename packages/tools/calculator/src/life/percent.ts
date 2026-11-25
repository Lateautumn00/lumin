/**
 * @file 百分比 / 折扣计算纯函数
 * @author cuilanchao
 * @date 2026-11-21
 * @description 四种常用口径：按百分比增减、两个数值的变化率、按折扣力度算折后价、由折后价反推原价。
 *              结果保留两位小数；非法输入返回中文错误信息，由 UI 映射结构化错误码。
 */
import { isFiniteNumber, round2 } from './num'

export type NumberOutcome = { ok: true; value: number } | { ok: false; message: string }

/** 百分比绝对值上限（防止误输入导致溢出） */
export const PERCENT_MAX = 10_000

/**
 * 在基值上按百分比增减：base × (1 + percent / 100)
 * @param base 基数
 * @param percent 百分比（正数为增长，负数为下降）
 */
export function applyPercentChange(base: number, percent: number): NumberOutcome {
  if (!isFiniteNumber(base)) return { ok: false, message: '基数需为有效数字' }
  if (!isFiniteNumber(percent) || Math.abs(percent) > PERCENT_MAX) {
    return { ok: false, message: `百分比需在 -${PERCENT_MAX}–${PERCENT_MAX} 之间` }
  }
  return { ok: true, value: round2(base * (1 + percent / 100)) }
}

/**
 * 计算从 from 到 to 的变化率（%）
 * @param from 原值（不得为 0）
 * @param to 新值
 */
export function percentChange(from: number, to: number): NumberOutcome {
  if (!isFiniteNumber(from) || !isFiniteNumber(to)) {
    return { ok: false, message: '原值与新值需为有效数字' }
  }
  if (from === 0) return { ok: false, message: '原值不能为 0' }
  return { ok: true, value: round2(((to - from) / from) * 100) }
}

/**
 * 按折扣力度计算折后价：original × (1 - percentOff / 100)
 * @param original 原价
 * @param percentOff 折扣力度（0–100，20 表示减 20%）
 */
export function discountPrice(original: number, percentOff: number): NumberOutcome {
  if (!isFiniteNumber(original) || original < 0) {
    return { ok: false, message: '原价需为不小于 0 的数字' }
  }
  if (!isFiniteNumber(percentOff) || percentOff < 0 || percentOff > 100) {
    return { ok: false, message: '折扣力度需在 0–100 之间' }
  }
  return { ok: true, value: round2(original * (1 - percentOff / 100)) }
}

/**
 * 由折后价与折扣力度反推原价：discounted / (1 - percentOff / 100)
 * @param discounted 折后价
 * @param percentOff 折扣力度（0–100，不含 100）
 */
export function originalPrice(discounted: number, percentOff: number): NumberOutcome {
  if (!isFiniteNumber(discounted) || discounted < 0) {
    return { ok: false, message: '折后价需为不小于 0 的数字' }
  }
  if (!isFiniteNumber(percentOff) || percentOff < 0 || percentOff >= 100) {
    return { ok: false, message: '折扣力度需在 0–100 之间（不含 100）' }
  }
  return { ok: true, value: round2(discounted / (1 - percentOff / 100)) }
}
