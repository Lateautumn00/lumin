import { describe, expect, it } from 'vitest'

import { calcMortgage, type LoanMethod } from './mortgage'

describe('等额本息', () => {
  it('零利率：12000 元 1 年 → 每期 1000 元、总利息 0', () => {
    const outcome = calcMortgage({
      principal: 12000,
      annualRate: 0,
      years: 1,
      method: 'equal-payment'
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const result = outcome.value
    expect(result.months).toBe(12)
    expect(result.monthlyPayment).toBe(1000)
    expect(result.firstPayment).toBe(1000)
    expect(result.lastPayment).toBe(1000)
    expect(result.totalInterest).toBe(0)
    expect(result.totalPayment).toBe(12000)
    expect(result.schedule).toHaveLength(12)
    for (const row of result.schedule) {
      expect(row.payment).toBe(1000)
      expect(row.interestPart).toBe(0)
    }
  })

  it('100000 元 / 12% / 1 年：月供约 8884.88，本息结构自洽', () => {
    const outcome = calcMortgage({
      principal: 100000,
      annualRate: 12,
      years: 1,
      method: 'equal-payment'
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const result = outcome.value
    expect(result.monthlyPayment).toBeCloseTo(8884.88, 2)
    expect(result.schedule).toHaveLength(12)
    expect(result.totalInterest).toBeCloseTo(6618.55, 2)
    expect(result.totalPayment).toBeCloseTo(106618.55, 2)

    const principalSum = result.schedule.reduce((sum, row) => sum + row.principalPart, 0)
    expect(principalSum).toBeCloseTo(100000, 0)
    expect(result.schedule[0]?.payment).toBe(result.monthlyPayment)
    expect(result.schedule[11]?.remaining).toBe(0)
  })

  it('30 年长周期：首末一致、末期结清、本金合计等于贷款额', () => {
    const outcome = calcMortgage({
      principal: 1000000,
      annualRate: 4.9,
      years: 30,
      method: 'equal-payment'
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const result = outcome.value
    expect(result.months).toBe(360)
    expect(result.schedule).toHaveLength(360)
    expect(result.monthlyPayment).toBeGreaterThan(5000)
    expect(result.monthlyPayment).toBeLessThan(5600)
    expect(result.totalPayment).toBeCloseTo(1000000 + result.totalInterest, 2)
    expect(result.totalInterest).toBeGreaterThan(0)

    const principalSum = result.schedule.reduce((sum, row) => sum + row.principalPart, 0)
    expect(principalSum).toBeCloseTo(1000000, 0)
    for (const row of result.schedule) {
      expect(row.remaining).toBeGreaterThanOrEqual(0)
    }
    expect(result.schedule[359]?.remaining).toBe(0)
  })
})

describe('等额本金', () => {
  it('120000 元 / 12% / 1 年：首月 11200、末月 10100、总利息 7800', () => {
    const outcome = calcMortgage({
      principal: 120000,
      annualRate: 12,
      years: 1,
      method: 'equal-principal'
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const result = outcome.value
    expect(result.months).toBe(12)
    expect(result.monthlyPayment).toBe(11200)
    expect(result.firstPayment).toBe(11200)
    expect(result.lastPayment).toBe(10100)
    expect(result.totalInterest).toBe(7800)
    expect(result.totalPayment).toBe(127800)
    expect(result.schedule[0]?.principalPart).toBe(10000)
    expect(result.schedule[11]?.principalPart).toBe(10000)
    expect(result.schedule[11]?.remaining).toBe(0)
  })

  it('零利率：12000 元 1 年 → 每期 1000 元、总利息 0', () => {
    const outcome = calcMortgage({
      principal: 12000,
      annualRate: 0,
      years: 1,
      method: 'equal-principal'
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const result = outcome.value
    expect(result.monthlyPayment).toBe(1000)
    expect(result.lastPayment).toBe(1000)
    expect(result.totalInterest).toBe(0)
    for (const row of result.schedule) expect(row.payment).toBe(1000)
  })

  it('月供逐期递减（利息随剩余本金下降）', () => {
    const outcome = calcMortgage({
      principal: 600000,
      annualRate: 3.6,
      years: 10,
      method: 'equal-principal'
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const payments = outcome.value.schedule.map((row) => row.payment)
    for (let index = 1; index < payments.length; index += 1) {
      const current = payments[index] ?? Number.NaN
      const previous = payments[index - 1] ?? Number.NaN
      expect(current).toBeLessThanOrEqual(previous)
    }
  })
})

describe('参数校验', () => {
  it('本金非法 → 返回中文提示', () => {
    const base = { annualRate: 4.9, years: 30, method: 'equal-payment' as LoanMethod }
    expect(calcMortgage({ ...base, principal: 0 })).toEqual({
      ok: false,
      message: '贷款本金需为不小于 1 元的数字'
    })
    expect(calcMortgage({ ...base, principal: -100 })).toEqual({
      ok: false,
      message: '贷款本金需为不小于 1 元的数字'
    })
    expect(calcMortgage({ ...base, principal: Number.NaN }).ok).toBe(false)
    expect(calcMortgage({ ...base, principal: 100_000_001 }).ok).toBe(false)
  })

  it('利率越界 → 返回中文提示', () => {
    const base = { principal: 100000, years: 30, method: 'equal-payment' as LoanMethod }
    expect(calcMortgage({ ...base, annualRate: -0.1 })).toEqual({
      ok: false,
      message: '年利率需在 0–24% 之间'
    })
    expect(calcMortgage({ ...base, annualRate: 24.1 }).ok).toBe(false)
    expect(calcMortgage({ ...base, annualRate: Number.POSITIVE_INFINITY }).ok).toBe(false)
  })

  it('年限越界或非整数 → 返回中文提示', () => {
    const base = { principal: 100000, annualRate: 4.9, method: 'equal-payment' as LoanMethod }
    expect(calcMortgage({ ...base, years: 0 })).toEqual({
      ok: false,
      message: '贷款年限需为 1–50 的整数年'
    })
    expect(calcMortgage({ ...base, years: 51 }).ok).toBe(false)
    expect(calcMortgage({ ...base, years: 1.5 }).ok).toBe(false)
    expect(calcMortgage({ ...base, years: Number.NaN }).ok).toBe(false)
  })

  it('未知还款方式 → 返回中文提示', () => {
    const outcome = calcMortgage({
      principal: 100000,
      annualRate: 4.9,
      years: 30,
      method: 'interest-only' as LoanMethod
    })
    expect(outcome).toEqual({ ok: false, message: '不支持的还款方式' })
  })
})
