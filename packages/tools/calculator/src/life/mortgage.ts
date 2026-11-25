/**
 * @file 房贷计算纯函数（等额本息 / 等额本金）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 口径：年利率按「年利率 % / 12」折算月利率；金额保留两位小数；
 *              等额本息末期为结清尾差，等额本金末期本金为剩余本金。
 */
import { isFiniteNumber, round2 } from './num'

/** 还款方式：等额本息 / 等额本金 */
export type LoanMethod = 'equal-payment' | 'equal-principal'

/** 房贷输入（单位：元 / % / 年） */
export interface MortgageInput {
  principal: number
  annualRate: number
  years: number
  method: LoanMethod
}

/** 单期还款明细 */
export interface MortgageMonth {
  month: number
  payment: number
  principalPart: number
  interestPart: number
  remaining: number
}

/** 房贷计算结果（schedule 为完整还款计划，最多 600 期） */
export interface MortgageResult {
  method: LoanMethod
  months: number
  monthlyPayment: number
  firstPayment: number
  lastPayment: number
  totalPayment: number
  totalInterest: number
  schedule: MortgageMonth[]
}

export type MortgageOutcome = { ok: true; value: MortgageResult } | { ok: false; message: string }

export const MORTGAGE_PRINCIPAL_MIN = 1
export const MORTGAGE_PRINCIPAL_MAX = 100_000_000
export const MORTGAGE_RATE_MAX = 24
export const MORTGAGE_YEARS_MIN = 1
export const MORTGAGE_YEARS_MAX = 50

/**
 * 计算房贷月供与还款计划
 * @param input 本金/年利率/年限/还款方式
 */
export function calcMortgage(input: MortgageInput): MortgageOutcome {
  const { principal, annualRate, years, method } = input

  if (!isFiniteNumber(principal) || principal < MORTGAGE_PRINCIPAL_MIN) {
    return { ok: false, message: `贷款本金需为不小于 ${MORTGAGE_PRINCIPAL_MIN} 元的数字` }
  }
  if (principal > MORTGAGE_PRINCIPAL_MAX) {
    return {
      ok: false,
      message: `贷款本金不得超过 ${MORTGAGE_PRINCIPAL_MAX.toLocaleString('zh-CN')} 元`
    }
  }
  if (!isFiniteNumber(annualRate) || annualRate < 0 || annualRate > MORTGAGE_RATE_MAX) {
    return { ok: false, message: `年利率需在 0–${MORTGAGE_RATE_MAX}% 之间` }
  }
  if (
    !isFiniteNumber(years) ||
    !Number.isInteger(years) ||
    years < MORTGAGE_YEARS_MIN ||
    years > MORTGAGE_YEARS_MAX
  ) {
    return {
      ok: false,
      message: `贷款年限需为 ${MORTGAGE_YEARS_MIN}–${MORTGAGE_YEARS_MAX} 的整数年`
    }
  }
  if (method !== 'equal-payment' && method !== 'equal-principal') {
    return { ok: false, message: '不支持的还款方式' }
  }

  const months = years * 12
  const monthlyRate = annualRate / 100 / 12
  const schedule: MortgageMonth[] = []
  let remaining = principal
  let monthlyPayment = 0
  let lastPayment = 0
  let totalInterest = 0

  if (method === 'equal-payment') {
    const growth = (1 + monthlyRate) ** months
    const payment =
      monthlyRate === 0 ? principal / months : (principal * monthlyRate * growth) / (growth - 1)
    monthlyPayment = round2(payment)

    for (let month = 1; month <= months; month += 1) {
      const interestPart = round2(remaining * monthlyRate)
      const principalPart = month === months ? round2(remaining) : round2(payment - interestPart)
      const pay = round2(principalPart + interestPart)
      remaining = round2(remaining - principalPart)
      if (month === months) remaining = 0
      schedule.push({ month, payment: pay, principalPart, interestPart, remaining })
      lastPayment = pay
    }

    totalInterest = round2(payment * months - principal)
  } else {
    const basePrincipal = principal / months
    const firstInterest = round2(principal * monthlyRate)
    monthlyPayment = round2(basePrincipal + firstInterest)

    for (let month = 1; month <= months; month += 1) {
      const interestPart = round2(remaining * monthlyRate)
      const principalPart = month === months ? round2(remaining) : round2(basePrincipal)
      const pay = round2(principalPart + interestPart)
      remaining = round2(remaining - principalPart)
      if (month === months) remaining = 0
      schedule.push({ month, payment: pay, principalPart, interestPart, remaining })
      lastPayment = pay
    }

    totalInterest = round2((principal * monthlyRate * (months + 1)) / 2)
  }

  return {
    ok: true,
    value: {
      method,
      months,
      monthlyPayment,
      firstPayment: schedule[0]?.payment ?? monthlyPayment,
      lastPayment,
      totalPayment: round2(principal + totalInterest),
      totalInterest,
      schedule
    }
  }
}
