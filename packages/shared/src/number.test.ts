import { describe, expect, it } from 'vitest'

import { formatBytes, formatNumber } from './number'

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

describe('formatBytes', () => {
  it('B/KB/MB/GB 边界与 1 位小数', () => {
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB')
    expect(formatBytes(20 * 1024 ** 3)).toBe('20.0 GB')
  })

  it('0 与非有限/负值返回占位符', () => {
    expect(formatBytes(0)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(NaN)).toBe('—')
    expect(formatBytes(Infinity)).toBe('—')
  })
})
