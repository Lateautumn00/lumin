/**
 * @file 工资个税计算纯函数（月度口径）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 采用居民综合所得月度换算税率表：应纳税所得额 = 税前工资 - 五险一金 - 专项附加扣除 - 5000；
 *              速算扣除数保证税率档位连续；不含年终奖、不含年度汇算。
 */
import { isFiniteNumber, round2 } from './num'

/** 个税起征点（元/月） */
export const TAX_MONTHLY_THRESHOLD = 5000
/** 税前工资上限（防止误输入天文数字） */
export const TAX_GROSS_MAX = 10_000_000

/** 月度累进税率档位 */
export interface TaxBracket {
  upTo: number
  rate: number
  deduction: number
}

/** 最高档（45%，无上限） */
const TOP_BRACKET: TaxBracket = { upTo: Number.POSITIVE_INFINITY, rate: 0.45, deduction: 15160 }

/** 月度换算税率表（速算扣除数口径） */
export const TAX_BRACKETS: readonly TaxBracket[] = [
  { upTo: 3000, rate: 0.03, deduction: 0 },
  { upTo: 12000, rate: 0.1, deduction: 210 },
  { upTo: 25000, rate: 0.2, deduction: 1410 },
  { upTo: 35000, rate: 0.25, deduction: 2660 },
  { upTo: 55000, rate: 0.3, deduction: 4410 },
  { upTo: 80000, rate: 0.35, deduction: 7160 },
  TOP_BRACKET
]

/** 个税输入（单位：元/月） */
export interface SalaryTaxInput {
  grossSalary: number
  socialInsurance: number
  specialDeduction: number
}

/** 个税计算结果 */
export interface SalaryTaxResult {
  taxableIncome: number
  tax: number
  netSalary: number
  effectiveRate: number
  bracketRate: number
}

export type SalaryTaxOutcome = { ok: true; value: SalaryTaxResult } | { ok: false; message: string }

/**
 * 查税率档位（应纳税所得额落在首个 upTo 内的档位）
 * @param taxableIncome 应纳税所得额（≥0）
 */
export function findTaxBracket(taxableIncome: number): TaxBracket {
  const matched = TAX_BRACKETS.find((bracket) => taxableIncome <= bracket.upTo)
  return matched ?? TOP_BRACKET
}

/**
 * 计算月度工资个税与税后收入
 * @param input 税前工资/五险一金/专项附加扣除
 */
export function calcSalaryTax(input: SalaryTaxInput): SalaryTaxOutcome {
  const { grossSalary, socialInsurance, specialDeduction } = input

  if (!isFiniteNumber(grossSalary) || grossSalary < 0 || grossSalary > TAX_GROSS_MAX) {
    return { ok: false, message: `税前月薪需在 0–${TAX_GROSS_MAX.toLocaleString('zh-CN')} 元之间` }
  }
  if (!isFiniteNumber(socialInsurance) || socialInsurance < 0) {
    return { ok: false, message: '五险一金需为不小于 0 的数字' }
  }
  if (!isFiniteNumber(specialDeduction) || specialDeduction < 0) {
    return { ok: false, message: '专项附加扣除需为不小于 0 的数字' }
  }
  if (socialInsurance > grossSalary) {
    return { ok: false, message: '五险一金不得大于税前月薪' }
  }
  if (specialDeduction > grossSalary) {
    return { ok: false, message: '专项附加扣除不得大于税前月薪' }
  }

  const taxableIncome = round2(
    Math.max(0, grossSalary - socialInsurance - specialDeduction - TAX_MONTHLY_THRESHOLD)
  )
  const bracket = findTaxBracket(taxableIncome)
  const tax = round2(Math.max(0, taxableIncome * bracket.rate - bracket.deduction))
  const netSalary = round2(grossSalary - socialInsurance - tax)

  return {
    ok: true,
    value: {
      taxableIncome,
      tax,
      netSalary,
      effectiveRate: grossSalary === 0 ? 0 : round2((tax / grossSalary) * 100),
      bracketRate: round2(bracket.rate * 100)
    }
  }
}
