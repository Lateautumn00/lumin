import { describe, expect, it } from 'vitest'

import { applyPercentChange, discountPrice, originalPrice, percentChange } from './percent'

describe('按百分比增减', () => {
  it('增长与下降', () => {
    expect(applyPercentChange(100, 20)).toEqual({ ok: true, value: 120 })
    expect(applyPercentChange(200, -15)).toEqual({ ok: true, value: 170 })
    expect(applyPercentChange(88.5, 0)).toEqual({ ok: true, value: 88.5 })
    expect(applyPercentChange(0, 30)).toEqual({ ok: true, value: 0 })
  })

  it('结果保留两位小数', () => {
    expect(applyPercentChange(33.33, 7.7)).toEqual({ ok: true, value: 35.9 })
  })

  it('非法输入', () => {
    expect(applyPercentChange(Number.NaN, 10)).toEqual({ ok: false, message: '基数需为有效数字' })
    expect(applyPercentChange(100, Number.NaN)).toEqual({
      ok: false,
      message: '百分比需在 -10000–10000 之间'
    })
    expect(applyPercentChange(100, 10001).ok).toBe(false)
    expect(applyPercentChange(100, 10000).ok).toBe(true)
  })
})

describe('变化率', () => {
  it('正负变化与零变化', () => {
    expect(percentChange(100, 120)).toEqual({ ok: true, value: 20 })
    expect(percentChange(120, 100)).toEqual({ ok: true, value: -16.67 })
    expect(percentChange(50, 50)).toEqual({ ok: true, value: 0 })
  })

  it('原值为 0 或非法数字', () => {
    expect(percentChange(0, 100)).toEqual({ ok: false, message: '原值不能为 0' })
    expect(percentChange(Number.NaN, 100)).toEqual({
      ok: false,
      message: '原值与新值需为有效数字'
    })
    expect(percentChange(100, Number.POSITIVE_INFINITY).ok).toBe(false)
  })
})

describe('折扣价', () => {
  it('按力度计算折后价', () => {
    expect(discountPrice(199, 20)).toEqual({ ok: true, value: 159.2 })
    expect(discountPrice(100, 0)).toEqual({ ok: true, value: 100 })
    expect(discountPrice(100, 100)).toEqual({ ok: true, value: 0 })
  })

  it('非法输入', () => {
    expect(discountPrice(-1, 20)).toEqual({ ok: false, message: '原价需为不小于 0 的数字' })
    expect(discountPrice(100, -1)).toEqual({
      ok: false,
      message: '折扣力度需在 0–100 之间'
    })
    expect(discountPrice(100, 101).ok).toBe(false)
    expect(discountPrice(Number.NaN, 10).ok).toBe(false)
  })
})

describe('折后价反推原价', () => {
  it('反推结果四舍五入到分', () => {
    expect(originalPrice(159.2, 20)).toEqual({ ok: true, value: 199 })
    expect(originalPrice(80, 20)).toEqual({ ok: true, value: 100 })
    expect(originalPrice(0, 50)).toEqual({ ok: true, value: 0 })
  })

  it('非法输入（力度 100 无法反推）', () => {
    expect(originalPrice(-1, 20)).toEqual({ ok: false, message: '折后价需为不小于 0 的数字' })
    expect(originalPrice(100, 100)).toEqual({
      ok: false,
      message: '折扣力度需在 0–100 之间（不含 100）'
    })
    expect(originalPrice(100, -1).ok).toBe(false)
    expect(originalPrice(Number.NaN, 20).ok).toBe(false)
  })
})
