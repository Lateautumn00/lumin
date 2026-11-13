import { describe, expect, it } from 'vitest'

import { formatNumber } from './number'

describe('formatNumber', () => {
  it('去浮点噪声', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(1 / 3)).toBe('0.333333333333333')
  })

  it('整数与负数原样', () => {
    expect(formatNumber(7)).toBe('7')
    expect(formatNumber(-2.5)).toBe('-2.5')
    expect(formatNumber(0)).toBe('0')
  })

  it('极大极小值以科学计数输出', () => {
    expect(formatNumber(1e21)).toBe('1e+21')
    expect(formatNumber(1e-7)).toBe('1e-7')
  })

  it('非有限值直接字符串化', () => {
    expect(formatNumber(Infinity)).toBe('Infinity')
    expect(formatNumber(NaN)).toBe('NaN')
  })
})
