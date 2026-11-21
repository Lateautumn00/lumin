/**
 * @file base.ts 单测：四进制互转、负数、超 2^53 大整数与错误分支
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'

import { convertBase, MAX_BASE_INPUT, type BaseConversion, type Radix } from './base'

function valueOf(input: string, radix: Radix): BaseConversion {
  const result = convertBase(input, radix)
  if (!result.ok) throw new Error(`期望成功，实际 ${result.error.code}：${result.error.message}`)
  return result.value
}

function errorCodeOf(input: string, radix: Radix): string {
  const result = convertBase(input, radix)
  expect(result.ok).toBe(false)
  return result.ok ? '' : result.error.code
}

describe('convertBase 基础换算', () => {
  it('十进制 255 → 四进制字符串', () => {
    expect(valueOf('255', 10)).toEqual({
      binary: '11111111',
      octal: '377',
      decimal: '255',
      hex: 'ff'
    })
  })

  it('二 / 八 / 十六进制输入得到同一结果', () => {
    const expected = valueOf('255', 10)
    expect(valueOf('11111111', 2)).toEqual(expected)
    expect(valueOf('377', 8)).toEqual(expected)
    expect(valueOf('ff', 16)).toEqual(expected)
    expect(valueOf('FF', 16)).toEqual(expected)
    expect(valueOf('  ff  ', 16)).toEqual(expected)
  })

  it('零与正负号', () => {
    expect(valueOf('0', 10)).toEqual({ binary: '0', octal: '0', decimal: '0', hex: '0' })
    expect(valueOf('+42', 10).decimal).toBe('42')
    const negative = valueOf('-10', 10)
    expect(negative.binary).toBe('-1010')
    expect(negative.octal).toBe('-12')
    expect(negative.hex).toBe('-a')
    expect(convertBase('-ff', 16)).toEqual({
      ok: true,
      value: { binary: '-11111111', octal: '-377', decimal: '-255', hex: '-ff' }
    })
  })

  it('超过 2^53 的大整数不丢精度', () => {
    expect(valueOf('9007199254740993', 10).hex).toBe('20000000000001')
    expect(valueOf('20000000000001', 16).decimal).toBe('9007199254740993')
  })
})

describe('convertBase 错误分支', () => {
  it('空输入 → BASE_EMPTY', () => {
    expect(errorCodeOf('', 10)).toBe('BASE_EMPTY')
    expect(errorCodeOf('   ', 2)).toBe('BASE_EMPTY')
  })

  it('小数 → BASE_NOT_INTEGER', () => {
    expect(errorCodeOf('1.5', 10)).toBe('BASE_NOT_INTEGER')
    expect(errorCodeOf('ff.8', 16)).toBe('BASE_NOT_INTEGER')
  })

  it('非法字符 → BASE_INVALID_DIGIT', () => {
    expect(errorCodeOf('102', 2)).toBe('BASE_INVALID_DIGIT')
    expect(errorCodeOf('8', 8)).toBe('BASE_INVALID_DIGIT')
    expect(errorCodeOf('g', 16)).toBe('BASE_INVALID_DIGIT')
    expect(errorCodeOf('-2', 2)).toBe('BASE_INVALID_DIGIT')
    expect(errorCodeOf('+', 10)).toBe('BASE_INVALID_DIGIT')
  })

  it('超长输入 → BASE_TOO_LONG', () => {
    expect(errorCodeOf('1'.repeat(MAX_BASE_INPUT + 1), 10)).toBe('BASE_TOO_LONG')
  })
})
