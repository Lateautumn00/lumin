/**
 * @file 进制互转与位运算纯函数（纯 renderer，零 IPC、零依赖）
 * @author cuilanchao
 * @date 2026-11-23
 * @description M60 扩展（docs/spec/dev-toolbox.md M60 节）：进制解析、64 位无符号位运算与分组展示。
 * 非法输入一律抛 DT_INVALID_PAYLOAD（detail 指明原因），由渲染层展示并保留上一有效值
 */
import { toolError } from './errors'

/** 支持的进制 */
export type Radix = 2 | 8 | 10 | 16

/** 位运算类型（NOT 为单目，忽略右操作数） */
export type BitwiseOp = 'and' | 'or' | 'xor' | 'not'

/** 互转结果：signed 为按所选进制解析的原值（十进制可负），unsigned 为 64 位无符号视图 */
export interface ConvertedValue {
  /** 按所选进制解析出的原值（仅十进制可能为负） */
  signed: bigint
  /** 64 位无符号视图（负数按 BigInt.asUintN(64) 取补码） */
  unsigned: bigint
}

/** 64 位无符号上限 2^64-1（spec M60 位运算输入上限） */
export const MAX_UNSIGNED = (1n << 64n) - 1n

/** 互转区上限 2^63-1（spec M60：非负整数 ≤ 2^63-1，十进制负数绝对值 ≤ 63 位） */
const MAX_CONVERT = (1n << 63n) - 1n

/** 前缀正则：0x / 0b / 0o（大小写不敏感） */
const PREFIX_PATTERN = /^0([xXbBoO])/

/**
 * 所选进制对应的前缀字母（十进制无前缀）
 * @param from 进制
 */
function prefixKindFor(from: Radix): string {
  if (from === 2) return 'b'
  if (from === 8) return 'o'
  if (from === 16) return 'x'
  return ''
}

/**
 * 所选进制的合法字符集
 * @param from 进制
 */
function digitsPattern(from: Radix): RegExp {
  if (from === 2) return /^[01]+$/
  if (from === 8) return /^[0-7]+$/
  if (from === 16) return /^[0-9a-fA-F]+$/
  return /^[0-9]+$/
}

/**
 * 按进制把纯数位文本转为 BigInt（BigInt 仅识别 0x/0b/0o 前缀，其余进制需先补前缀）
 * @param digits 纯数位文本（已通过字符集校验）
 * @param from 进制
 */
function digitsToBigInt(digits: string, from: Radix): bigint {
  if (from === 16) return BigInt(`0x${digits}`)
  if (from === 8) return BigInt(`0o${digits}`)
  if (from === 2) return BigInt(`0b${digits}`)
  return BigInt(digits)
}

/**
 * 进制互转解析：容忍与所选进制一致的 0x/0b/0o 前缀，剥离空格与下划线分组；
 * 非法字符/小数/超范围抛 DT_INVALID_PAYLOAD
 * @param raw 原始输入
 * @param from 当前进制（2/8/10/16）
 * @returns 解析结果（signed 原值 + unsigned 64 位视图）
 */
export function convertBase(raw: string, from: Radix): ConvertedValue {
  let text = raw.replace(/[\s_]+/g, '')
  if (text === '') throw toolError('DT_INVALID_PAYLOAD', '请输入数值')

  // 仅当前进制与前缀一致时采纳（如十六进制输入 0x10 提取 10；0b 前缀在十六进制下按普通字符处理）
  const prefix = PREFIX_PATTERN.exec(text)
  if (prefix !== null && (prefix[1] ?? '').toLowerCase() === prefixKindFor(from)) {
    text = text.slice(2)
  }
  if (text === '') throw toolError('DT_INVALID_PAYLOAD', '请输入数值')

  let negative = false
  if (text.startsWith('-')) {
    negative = true
    text = text.slice(1)
    if (text === '') throw toolError('DT_INVALID_PAYLOAD', '请输入数值')
    if (from !== 10) throw toolError('DT_INVALID_PAYLOAD', '仅十进制支持负数输入')
  }

  if (!digitsPattern(from).test(text)) {
    if (text.includes('.')) throw toolError('DT_INVALID_PAYLOAD', '不支持小数，须为整数')
    throw toolError('DT_INVALID_PAYLOAD', `含非法字符或超出 ${from} 进制范围`)
  }

  const value = negative ? -digitsToBigInt(text, from) : digitsToBigInt(text, from)
  if (value > MAX_CONVERT) throw toolError('DT_INVALID_PAYLOAD', '超出范围（最大 2^63-1）')
  if (value < -MAX_CONVERT) {
    throw toolError('DT_INVALID_PAYLOAD', '负数超出范围（绝对值最大 2^63-1）')
  }

  return { signed: value, unsigned: value < 0n ? BigInt.asUintN(64, value) : value }
}

/**
 * 解析位运算输入（十进制非负整数，0 ~ 2^64-1）
 * @param raw 原始输入
 * @param label 字段名（A/B，用于 detail 定位）
 * @returns 非负 BigInt
 */
export function parseBitInput(raw: string, label: string): bigint {
  const text = raw.replace(/[\s_]+/g, '')
  if (text === '') throw toolError('DT_INVALID_PAYLOAD', `${label} 不能为空`)
  if (text.startsWith('-')) throw toolError('DT_INVALID_PAYLOAD', `${label} 须为非负整数`)
  if (!/^[0-9]+$/.test(text)) {
    if (text.includes('.')) throw toolError('DT_INVALID_PAYLOAD', `${label} 不支持小数，须为整数`)
    throw toolError('DT_INVALID_PAYLOAD', `${label} 须为十进制整数`)
  }
  const value = BigInt(text)
  if (value > MAX_UNSIGNED) {
    throw toolError('DT_INVALID_PAYLOAD', `${label} 超出范围（0 ~ 2^64-1）`)
  }
  return value
}

/**
 * 64 位无符号位运算（输入输出均按 BigInt.asUintN(64, …) 归一，界面注明口径）
 * @param a 左操作数
 * @param op 运算类型（AND/OR/XOR/NOT）
 * @param b 右操作数（NOT 单目时忽略）
 * @returns 64 位无符号结果
 */
export function bitwise(a: bigint, op: BitwiseOp, b: bigint): bigint {
  const x = BigInt.asUintN(64, a)
  const y = BigInt.asUintN(64, b)
  if (op === 'and') return BigInt.asUintN(64, x & y)
  if (op === 'or') return BigInt.asUintN(64, x | y)
  if (op === 'xor') return BigInt.asUintN(64, x ^ y)
  return BigInt.asUintN(64, ~x) // NOT 单目
}

/**
 * 读数分组：十六进制大写；BIN/OCT/HEX 每 4 位空格分组（自右向左），DEC 不分组
 * @param value 非负整数
 * @param radix 目标进制
 */
export function groupDigits(value: bigint, radix: Radix): string {
  const digits = value.toString(radix).toUpperCase()
  if (radix === 10) return digits
  const groups: string[] = []
  for (let end = digits.length; end > 0; end -= 4) {
    groups.unshift(digits.slice(Math.max(0, end - 4), end))
  }
  return groups.join(' ')
}

/**
 * 所需最少位宽（0 → 0 位）
 * @param value 非负整数
 * @returns 表示该值所需的最少二进制位数
 */
export function bitWidth(value: bigint): number {
  return value === 0n ? 0 : value.toString(2).length
}
