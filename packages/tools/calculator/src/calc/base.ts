/**
 * @file 进制换算纯函数（2 / 8 / 10 / 16 互转）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 用 BigInt 解析与输出，避免 Number 超过 2^53 后的精度丢失；仅支持整数
 */
import type { StructuredError } from '@lumin/shared'

/** 支持的输入进制 */
export type Radix = 2 | 8 | 10 | 16

/** 单次输入的字符上限（防超长输入拖垮渲染进程） */
export const MAX_BASE_INPUT = 512

/** 进制 → 合法数字字符集（十六进制输入允许大小写，解析时统一转小写） */
const RADIX_DIGITS: Record<Radix, string> = {
  2: '01',
  8: '01234567',
  10: '0123456789',
  16: '0123456789abcdef'
}

/** 通用数字表：索引即数值（0–15） */
const DIGITS = '0123456789abcdef'

/** 四种进制的换算结果（均为字符串，负数带前导 `-`） */
export interface BaseConversion {
  readonly binary: string
  readonly octal: string
  readonly decimal: string
  readonly hex: string
}

export type BaseErrorCode =
  'BASE_EMPTY' | 'BASE_TOO_LONG' | 'BASE_NOT_INTEGER' | 'BASE_INVALID_DIGIT'

export type BaseResult =
  | { readonly ok: true; readonly value: BaseConversion }
  | { readonly ok: false; readonly error: StructuredError }

function fail(code: BaseErrorCode, message: string, detail?: string): BaseResult {
  return { ok: false, error: detail === undefined ? { code, message } : { code, message, detail } }
}

/**
 * 把指定进制的整数字符串换算为 2/8/10/16 进制
 * @param input 原始输入（可带正负号，允许首尾空白）
 * @param radix 输入进制
 * @returns 成功返回四种进制字符串；失败返回结构化错误
 */
export function convertBase(input: string, radix: Radix): BaseResult {
  const text = input.trim()
  if (text === '') return fail('BASE_EMPTY', '请输入要转换的数值')
  if (text.length > MAX_BASE_INPUT) {
    return fail('BASE_TOO_LONG', `输入超过 ${MAX_BASE_INPUT} 个字符`, `当前 ${text.length} 个字符`)
  }
  if (text.includes('.')) {
    return fail('BASE_NOT_INTEGER', '进制转换仅支持整数，不支持小数')
  }

  const sign = text.startsWith('-') ? '-' : ''
  const body = text.startsWith('-') || text.startsWith('+') ? text.slice(1) : text
  if (body === '') {
    return fail('BASE_INVALID_DIGIT', '请输入有效数字', '仅包含正负号')
  }

  const lower = body.toLowerCase()
  const allowed = RADIX_DIGITS[radix]
  for (const char of lower) {
    if (!allowed.includes(char)) {
      return fail('BASE_INVALID_DIGIT', `字符「${char}」不属于 ${radix} 进制`, `输入「${body}」`)
    }
  }

  const base = BigInt(radix)
  let value = 0n
  for (const char of lower) {
    value = value * base + BigInt(DIGITS.indexOf(char))
  }
  if (sign === '-') value = -value

  return {
    ok: true,
    value: {
      binary: value.toString(2),
      octal: value.toString(8),
      decimal: value.toString(10),
      hex: value.toString(16)
    }
  }
}
