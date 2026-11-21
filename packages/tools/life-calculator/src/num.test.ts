import { describe, expect, it } from 'vitest'

import { isFiniteNumber, round2 } from './num'

describe('round2', () => {
  it('按分四舍五入', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(2.344)).toBe(2.34)
    expect(round2(2.345)).toBe(2.35)
    expect(round2(-1.005)).toBe(-1)
    expect(round2(0)).toBe(0)
  })
})

describe('isFiniteNumber', () => {
  it('排除空值与无穷', () => {
    expect(isFiniteNumber(0)).toBe(true)
    expect(isFiniteNumber(-1.5)).toBe(true)
    expect(isFiniteNumber(Number.NaN)).toBe(false)
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isFiniteNumber(null)).toBe(false)
    expect(isFiniteNumber(undefined)).toBe(false)
  })
})
