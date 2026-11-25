/**
 * @file 工具错误码与统一结果形状（UPPER_SNAKE；文案见 docs/spec/calculator.md §7.3，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 纯 renderer 工具也走统一结构化错误形状，便于 UI 按 code → 中文文案展示
 */
import type { StructuredError } from '@lumin/shared'

/** life-calculator 错误码全集（spec §4） */
export const LIFE_CALCULATOR_ERROR_CODES = [
  'LC_MORTGAGE_INVALID',
  'LC_TAX_INVALID',
  'LC_PERCENT_INVALID',
  'LC_CLIPBOARD_FAILED'
] as const

export type LifeCalculatorErrorCode = (typeof LIFE_CALCULATOR_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §4 同源） */
const MESSAGES: Record<LifeCalculatorErrorCode, string> = {
  LC_MORTGAGE_INVALID: '房贷参数不合法，请检查本金、利率与年限',
  LC_TAX_INVALID: '个税参数不合法，请检查工资与扣除项',
  LC_PERCENT_INVALID: '百分比参数不合法',
  LC_CLIPBOARD_FAILED: '复制失败，请手动选择文本复制'
}

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（具体越界项）
 */
export function toolError(code: LifeCalculatorErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 错误码 → 中文文案（未知码回退原码，避免空白提示）
 * @param code 结构化错误码字符串
 */
export function errorMessage(code: string): string {
  return MESSAGES[code as LifeCalculatorErrorCode] ?? code
}
