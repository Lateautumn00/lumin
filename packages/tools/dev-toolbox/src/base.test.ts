/**
 * @file base.ts 单测：进制互转（前缀/分组/边界）、64 位无符号位运算与错误分支
 * @author cuilanchao
 * @date 2026-11-23
 */
import { describe, expect, it } from 'vitest'
import { bitWidth, bitwise, convertBase, groupDigits, MAX_UNSIGNED, parseBitInput } from './base'

/** 断言抛出 DT_INVALID_PAYLOAD（可附带 detail 片段断言） */
function expectInvalidInput(action: () => unknown, detailPart?: string): void {
  let caught: unknown = null
  try {
    action()
  } catch (err) {
    caught = err
  }
  const candidate = caught as { code?: string; message?: string; detail?: string } | null
  expect(candidate).not.toBeNull()
  expect(candidate?.code).toBe('DT_INVALID_PAYLOAD')
  expect(candidate?.message).toBe('参数无效')
  if (detailPart !== undefined) expect(candidate?.detail).toContain(detailPart)
}

describe('convertBase（四进制互转与前缀）', () => {
  it('255 十进制 → BIN/OCT/HEX 读数', () => {
    const converted = convertBase('255', 10)
    expect(converted.signed).toBe(255n)
    expect(converted.unsigned).toBe(255n)
    expect(groupDigits(converted.unsigned, 2)).toBe('1111 1111')
    expect(groupDigits(converted.unsigned, 8)).toBe('377')
    expect(groupDigits(converted.unsigned, 10)).toBe('255')
    expect(groupDigits(converted.unsigned, 16)).toBe('FF')
  })

  it('0xFF 前缀与所选进制一致时采纳', () => {
    expect(convertBase('0xFF', 16).signed).toBe(255n)
    expect(convertBase('0xff', 16).signed).toBe(255n)
    expect(convertBase('0b1010', 2).signed).toBe(10n)
    expect(convertBase('0o17', 8).signed).toBe(15n)
  })

  it('前缀与所选进制不一致时按普通字符解析或报非法字符', () => {
    expectInvalidInput(() => convertBase('0xFF', 10), '非法字符')
    expectInvalidInput(() => convertBase('0b1010', 10), '非法字符')
    expectInvalidInput(() => convertBase('0x1f', 8), '非法字符')
  })

  it('剥离下划线与空格分组', () => {
    expect(convertBase('1_000_000', 10).signed).toBe(1_000_000n)
    expect(convertBase('DE_AD_BEEF', 16).signed).toBe(0xdeadbeefn)
    expect(convertBase('1111 1111', 2).signed).toBe(255n)
  })

  it('范围边界：非负 ≤ 2^63-1，十进制负数绝对值 ≤ 2^63-1', () => {
    expect(convertBase('9223372036854775807', 10).signed).toBe((1n << 63n) - 1n)
    expectInvalidInput(() => convertBase('9223372036854775808', 10), '超出范围')
    expect(convertBase('-9223372036854775807', 10).signed).toBe(-((1n << 63n) - 1n))
    expectInvalidInput(() => convertBase('-9223372036854775808', 10), '负数超出范围')
    expectInvalidInput(() => convertBase('FF', 2), '非法字符')
  })

  it('负十进制按 asUintN(64) 补码视图展示', () => {
    const converted = convertBase('-1', 10)
    expect(converted.signed).toBe(-1n)
    expect(converted.unsigned).toBe(MAX_UNSIGNED)
    expect(converted.unsigned).toBe(2n ** 64n - 1n)
    expect(groupDigits(converted.unsigned, 16)).toBe('FFFF FFFF FFFF FFFF')
    expect(bitWidth(converted.unsigned)).toBe(64)
    expectInvalidInput(() => convertBase('-1', 16), '仅十进制')
  })

  it('非法字符 / 小数 / 空输入', () => {
    expectInvalidInput(() => convertBase('abc', 10), '非法字符')
    expectInvalidInput(() => convertBase('0xG', 16), '非法字符')
    expectInvalidInput(() => convertBase('3.14', 10), '不支持小数')
    expectInvalidInput(() => convertBase('2.5', 2), '不支持小数')
    expectInvalidInput(() => convertBase('   ', 10), '请输入数值')
    expectInvalidInput(() => convertBase('0x', 16), '请输入数值')
  })
})

describe('parseBitInput（位运算输入，十进制 0 ~ 2^64-1）', () => {
  it('2^64-1 边界内采纳、越界拒绝', () => {
    expect(parseBitInput('18446744073709551615', 'A')).toBe(MAX_UNSIGNED)
    expect(parseBitInput('0', 'B')).toBe(0n)
    expectInvalidInput(() => parseBitInput('18446744073709551616', 'A'), '超出范围')
  })

  it('负数 / 小数 / 非法字符 / 空输入拒绝', () => {
    expectInvalidInput(() => parseBitInput('-1', 'A'), '非负整数')
    expectInvalidInput(() => parseBitInput('1.5', 'B'), '不支持小数')
    expectInvalidInput(() => parseBitInput('12a', 'A'), '十进制整数')
    expectInvalidInput(() => parseBitInput('', 'A'), '不能为空')
  })
})

describe('bitwise（64 位无符号口径）', () => {
  it('AND / OR / XOR 按位运算', () => {
    expect(bitwise(12n, 'and', 10n)).toBe(8n)
    expect(bitwise(12n, 'or', 10n)).toBe(14n)
    expect(bitwise(12n, 'xor', 10n)).toBe(6n)
  })

  it('NOT 单目：0 → 2^64-1，忽略右操作数', () => {
    expect(bitwise(0n, 'not', 0n)).toBe(MAX_UNSIGNED)
    expect(bitwise(255n, 'not', 999n)).toBe(MAX_UNSIGNED - 255n)
    expect(bitwise(MAX_UNSIGNED, 'not', 0n)).toBe(0n)
  })

  it('输入超界或为负时按 asUintN(64) 归一', () => {
    expect(bitwise(MAX_UNSIGNED, 'or', 0n)).toBe(MAX_UNSIGNED)
    expect(bitwise(-1n, 'and', 255n)).toBe(255n)
    expect(bitwise(MAX_UNSIGNED + 1n, 'or', 0n)).toBe(0n)
  })
})

describe('groupDigits（分组宽度）', () => {
  it('十六进制大写并按 4 位空格分组', () => {
    expect(groupDigits(0x12345n, 16)).toBe('1 2345')
    expect(groupDigits(0xffffffffn, 16)).toBe('FFFF FFFF')
    expect(groupDigits(0n, 16)).toBe('0')
    expect(groupDigits(255n, 16)).toBe('FF')
  })

  it('BIN/OCT 同样按 4 位分组且每组不超过 4 位', () => {
    expect(groupDigits(255n, 2)).toBe('1111 1111')
    expect(groupDigits(0o77777n, 8)).toBe('7 7777')
    const groups = groupDigits((1n << 20n) - 1n, 2).split(' ')
    expect(groups.length).toBe(5)
    for (const group of groups) expect(group.length).toBeLessThanOrEqual(4)
  })

  it('十进制不分组', () => {
    expect(groupDigits(1_234_567n, 10)).toBe('1234567')
  })
})

describe('bitWidth（最少位宽）', () => {
  it('按二进制位数计算', () => {
    expect(bitWidth(0n)).toBe(0)
    expect(bitWidth(255n)).toBe(8)
    expect(bitWidth(256n)).toBe(9)
    expect(bitWidth(MAX_UNSIGNED)).toBe(64)
  })
})
