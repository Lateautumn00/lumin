import { describe, expect, it } from 'vitest'

import { TAX_BRACKETS, calcSalaryTax, findTaxBracket } from './tax'

describe('工资个税（月度口径）', () => {
  it('10000 元 / 五险一金 0 → 应纳税 5000、个税 290、税后 9710', () => {
    const outcome = calcSalaryTax({
      grossSalary: 10000,
      socialInsurance: 0,
      specialDeduction: 0
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value).toEqual({
      taxableIncome: 5000,
      tax: 290,
      netSalary: 9710,
      effectiveRate: 2.9,
      bracketRate: 10
    })
  })

  it('未达起征点 → 个税 0、税后等于税前（无五险一金）', () => {
    const outcome = calcSalaryTax({ grossSalary: 5000, socialInsurance: 0, specialDeduction: 0 })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.taxableIncome).toBe(0)
    expect(outcome.value.tax).toBe(0)
    expect(outcome.value.netSalary).toBe(5000)
    expect(outcome.value.effectiveRate).toBe(0)
  })

  it('20000 元 / 五险一金 2000 / 专项 1000 → 应纳税 12000、个税 990', () => {
    const outcome = calcSalaryTax({
      grossSalary: 20000,
      socialInsurance: 2000,
      specialDeduction: 1000
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.taxableIncome).toBe(12000)
    expect(outcome.value.tax).toBe(990)
    expect(outcome.value.netSalary).toBe(17010)
    expect(outcome.value.bracketRate).toBe(10)
  })

  it('50000 元 / 五险一金 5000 → 应纳税 40000、适用 30% 档、个税 7590', () => {
    const outcome = calcSalaryTax({
      grossSalary: 50000,
      socialInsurance: 5000,
      specialDeduction: 0
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.taxableIncome).toBe(40000)
    expect(outcome.value.bracketRate).toBe(30)
    expect(outcome.value.tax).toBe(7590)
  })

  it('100000 元 → 应纳税 95000、适用 45% 档、个税 27590', () => {
    const outcome = calcSalaryTax({ grossSalary: 100000, socialInsurance: 0, specialDeduction: 0 })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.taxableIncome).toBe(95000)
    expect(outcome.value.bracketRate).toBe(45)
    expect(outcome.value.tax).toBe(27590)
  })

  it('档位边界连续（3000 与 3000.01 个税几乎相等）', () => {
    const low = calcSalaryTax({ grossSalary: 8000, socialInsurance: 0, specialDeduction: 0 })
    const high = calcSalaryTax({ grossSalary: 8000.01, socialInsurance: 0, specialDeduction: 0 })
    expect(low.ok && high.ok).toBe(true)
    if (!low.ok || !high.ok) return
    expect(low.value.taxableIncome).toBe(3000)
    expect(low.value.tax).toBe(90)
    expect(high.value.taxableIncome).toBe(3000.01)
    expect(high.value.tax).toBeCloseTo(90, 1)
  })

  it('税额按两位小数取整', () => {
    const outcome = calcSalaryTax({
      grossSalary: 10000.13,
      socialInsurance: 0,
      specialDeduction: 0
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.taxableIncome).toBe(5000.13)
    expect(outcome.value.tax).toBe(290.01)
  })
})

describe('税率档位查表', () => {
  it('边界值命中正确档位', () => {
    expect(findTaxBracket(0).rate).toBe(0.03)
    expect(findTaxBracket(3000).rate).toBe(0.03)
    expect(findTaxBracket(3000.01).rate).toBe(0.1)
    expect(findTaxBracket(12000).rate).toBe(0.1)
    expect(findTaxBracket(12000.01).rate).toBe(0.2)
    expect(findTaxBracket(80000).rate).toBe(0.35)
    expect(findTaxBracket(100000).rate).toBe(0.45)
  })

  it('档位表共 7 档且速算扣除数递增', () => {
    expect(TAX_BRACKETS).toHaveLength(7)
    for (let index = 1; index < TAX_BRACKETS.length; index += 1) {
      const current = TAX_BRACKETS[index]
      const previous = TAX_BRACKETS[index - 1]
      expect(current).toBeDefined()
      expect(previous).toBeDefined()
      if (current === undefined || previous === undefined) return
      expect(current.deduction).toBeGreaterThan(previous.deduction)
      expect(current.rate).toBeGreaterThan(previous.rate)
    }
  })
})

describe('参数校验', () => {
  it('工资非法 → 中文提示', () => {
    const base = { socialInsurance: 0, specialDeduction: 0 }
    expect(calcSalaryTax({ ...base, grossSalary: -1 })).toEqual({
      ok: false,
      message: '税前月薪需在 0–10,000,000 元之间'
    })
    expect(calcSalaryTax({ ...base, grossSalary: Number.NaN }).ok).toBe(false)
    expect(calcSalaryTax({ ...base, grossSalary: 10_000_001 }).ok).toBe(false)
  })

  it('扣除项为负 → 中文提示', () => {
    const base = { grossSalary: 10000, specialDeduction: 0 }
    expect(calcSalaryTax({ ...base, socialInsurance: -1 })).toEqual({
      ok: false,
      message: '五险一金需为不小于 0 的数字'
    })
    expect(calcSalaryTax({ grossSalary: 10000, socialInsurance: 0, specialDeduction: -1 })).toEqual(
      { ok: false, message: '专项附加扣除需为不小于 0 的数字' }
    )
  })

  it('扣除项大于税前工资 → 中文提示', () => {
    expect(
      calcSalaryTax({ grossSalary: 10000, socialInsurance: 10001, specialDeduction: 0 })
    ).toEqual({ ok: false, message: '五险一金不得大于税前月薪' })
    expect(
      calcSalaryTax({ grossSalary: 10000, socialInsurance: 0, specialDeduction: 10001 })
    ).toEqual({ ok: false, message: '专项附加扣除不得大于税前月薪' })
  })
})
