/**
 * @file 中文信息纯函数：数据脱敏四规则 / 身份证校验 / 金额大写（spec/misc-toolbox.md M60）
 * @author cuilanchao
 * @date 2026-11-23
 * @description 零 IPC、零依赖：脱敏未命中返回 null（UI 显示「未命中」）；
 *              身份证按 GB 11643 加权模 11 校验；金额按标准现金大写规则转换。
 */
import type { StructuredError } from '@lumin/shared'

import { toolError } from './errors'

/** 身份证校验输出：出生日期（YYYY-MM-DD）与性别（顺序码奇男偶女） */
export interface IdCardInfo {
  birthDate: string
  gender: '男' | '女'
}

/** 纯函数统一结果：成功带值，失败带结构化错误（与 ip.ts 同形状，不 throw） */
export type ChineseResult<T> = { ok: true; value: T } | { ok: false; error: StructuredError }

/* ---------- 数据脱敏 ---------- */

const PHONE_RE = /^1[3-9]\d{9}$/
const ID_CARD_MASK_RE = /^\d{17}[\dX]$/
const EMAIL_RE = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/
const NAME_RE = /^[^\d@]{2,}$/

/**
 * 手机号脱敏：`1[3-9]` 开头 11 位命中，保留前 3 后 4 中间四星；未命中返回 null
 * @param input 原始输入
 */
export function maskPhone(input: string): string | null {
  const value = input.trim()
  if (!PHONE_RE.test(value)) return null
  return `${value.slice(0, 3)}****${value.slice(7)}`
}

/**
 * 身份证脱敏：18 位命中，保留前 4 后 4 中间 10 星；未命中返回 null
 * @param input 原始输入
 */
export function maskIdCard(input: string): string | null {
  const value = input.trim().toUpperCase()
  if (!ID_CARD_MASK_RE.test(value)) return null
  return `${value.slice(0, 4)}${'*'.repeat(10)}${value.slice(14)}`
}

/**
 * 邮箱脱敏：命中保留首字符 + `***` + `@` + 域名；未命中返回 null
 * @param input 原始输入
 */
export function maskEmail(input: string): string | null {
  const value = input.trim()
  const match = EMAIL_RE.exec(value)
  if (match === null) return null
  const local = match[1] ?? ''
  const domain = match[2] ?? ''
  return `${local.charAt(0)}***@${domain}`
}

/**
 * 姓名脱敏：不含数字与 @ 且至少 2 字命中，保留首字其余星号；未命中返回 null
 * @param input 原始输入
 */
export function maskName(input: string): string | null {
  const value = input.trim()
  if (!NAME_RE.test(value)) return null
  return `${value.charAt(0)}${'*'.repeat(value.length - 1)}`
}

/* ---------- 身份证校验 ---------- */

/** GB 11643 加权因子（前 17 位） */
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const

/** 模 11 → 校验字符（0-9X） */
const ID_CHECK_CHARS = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'] as const

/** 出生日期（YYYYMMDD）合法性：月份与当月天数（含闰年） */
function isValidBirthDate(raw: string): boolean {
  const year = Number(raw.slice(0, 4))
  const month = Number(raw.slice(4, 6))
  const day = Number(raw.slice(6, 8))
  if (month < 1 || month > 12) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const daysOfMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const maxDay = daysOfMonth[month - 1]
  return maxDay !== undefined && day >= 1 && day <= maxDay
}

/** GB 11643 加权模 11 校验位比对（输入须已归一化为 18 位大写） */
function isChecksumValid(value: string): boolean {
  let sum = 0
  for (const [index, weight] of ID_WEIGHTS.entries()) {
    sum += (value.charCodeAt(index) - 48) * weight
  }
  const expected = ID_CHECK_CHARS[sum % 11] ?? ''
  return expected === value.charAt(17)
}

/**
 * 身份证校验：去空格并大写 X 后，15 位 → MT_ID_LEGACY、位数 / 字符 / 出生日期不符 →
 * MT_ID_INVALID、校验位不匹配 → MT_ID_CHECKSUM；通过返回出生日期与性别
 * @param input 原始输入
 */
export function validateIdCard(input: string): ChineseResult<IdCardInfo> {
  const value = input.replace(/\s+/g, '').toUpperCase()
  if (/^\d{15}$/.test(value)) {
    return { ok: false, error: toolError('MT_ID_LEGACY', '当前 15 位') }
  }
  if (!/^\d{17}[\dX]$/.test(value)) {
    return {
      ok: false,
      error: toolError(
        'MT_ID_INVALID',
        value.length !== 18 ? `需 18 位，当前 ${value.length} 位` : '仅允许数字，末位可为 X'
      )
    }
  }
  const birth = value.slice(6, 14)
  if (!isValidBirthDate(birth)) {
    return { ok: false, error: toolError('MT_ID_INVALID', '出生日期无效') }
  }
  if (!isChecksumValid(value)) {
    return { ok: false, error: toolError('MT_ID_CHECKSUM', '按 GB 11643 加权模 11 计算不匹配') }
  }
  const gender: '男' | '女' = Number(value.charAt(16)) % 2 === 1 ? '男' : '女'
  return {
    ok: true,
    value: {
      birthDate: `${birth.slice(0, 4)}-${birth.slice(4, 6)}-${birth.slice(6, 8)}`,
      gender
    }
  }
}

/* ---------- 金额大写 ---------- */

/** 大写数字 */
const AMOUNT_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'] as const

/** 4 位节内位权 */
const SECTION_UNITS = ['', '拾', '佰', '仟'] as const

/** 节间位权（整数部分最多 16 位，最高节为万亿） */
const GROUP_UNITS = ['', '万', '亿', '万亿'] as const

/** 千分位剥离后的合法金额：可选负号 + 整数 + 可选 1–2 位小数 */
const AMOUNT_RE = /^(-?)(\d+)(?:\.(\d{1,2}))?$/

/** 整数部分转换结果：文本 + 末节是否遗留待衔接的零 */
interface IntegerConversion {
  text: string
  pendingZero: boolean
}

function amountInvalid(detail: string): { ok: false; error: StructuredError } {
  return { ok: false, error: toolError('MT_AMOUNT_INVALID', detail) }
}

/** 单个 4 位节（0–9999）→ 大写，节内零合并为一个「零」 */
function convertSection(section: number): string {
  let text = ''
  let zeroPending = false
  let started = false
  for (let position = 3; position >= 0; position -= 1) {
    const digit = Math.floor(section / 10 ** position) % 10
    if (digit === 0) {
      if (started) zeroPending = true
      continue
    }
    if (zeroPending) {
      text += '零'
      zeroPending = false
    }
    text += (AMOUNT_DIGITS[digit] ?? '') + (SECTION_UNITS[position] ?? '')
    started = true
  }
  return text
}

/** 整数部分（无前导零、≤16 位）→ 大写；节间整零正确衔接，末节为零时遗留 pendingZero 供小数衔接 */
function convertInteger(value: string): IntegerConversion {
  if (value === '0') return { text: '零', pendingZero: false }
  const groups: number[] = []
  let rest = value
  while (rest.length > 0) {
    groups.push(Number(rest.slice(-4)))
    rest = rest.slice(0, -4)
  }
  const descending = groups.reverse()
  let text = ''
  let zeroPending = false
  for (const [position, group] of descending.entries()) {
    const unit = GROUP_UNITS[descending.length - 1 - position] ?? ''
    if (group === 0) {
      if (text !== '') zeroPending = true
      continue
    }
    if (text !== '' && group < 1000) zeroPending = true
    if (zeroPending) {
      text += '零'
      zeroPending = false
    }
    text += convertSection(group) + unit
  }
  return { text, pendingZero: zeroPending }
}

/** 小数部分（1–2 位）→ 角分大写：角为零且分非零时补「零」，分非零以「分」结尾 */
function convertFraction(fraction: string): string {
  const padded = fraction.length === 1 ? `${fraction}0` : fraction
  const jiao = Number(padded.charAt(0))
  const fen = Number(padded.charAt(1))
  let text = ''
  if (jiao !== 0) {
    text += `${AMOUNT_DIGITS[jiao] ?? ''}角`
  } else if (fen !== 0) {
    text += '零'
  }
  if (fen !== 0) text += `${AMOUNT_DIGITS[fen] ?? ''}分`
  return text
}

/**
 * 金额 → 人民币大写：允许负号与千分位、最多两位小数、整数部分 ≤16 位；
 * 角分皆无以「整」结尾，有分以「分」结尾；整数末节为零时以「零」衔接小数（如 1000000.25 → 壹佰万零贰角伍分）
 * @param input 原始输入
 */
export function amountToChinese(input: string): ChineseResult<string> {
  const value = input.trim().replace(/,/g, '')
  const match = AMOUNT_RE.exec(value)
  if (match === null) {
    return amountInvalid('请输入数字（允许负号、千分位与最多两位小数）')
  }
  const negative = match[1] === '-'
  const intRaw = match[2] ?? '0'
  const fraction = match[3] ?? ''
  if (intRaw.length > 16) return amountInvalid('整数部分不能超过 16 位')
  const intPart = intRaw.replace(/^0+(?=\d)/, '')
  const hasFraction = /[1-9]/.test(fraction)
  const integer = convertInteger(intPart)
  let text = ''
  if (negative && (intPart !== '0' || hasFraction)) text += '负'
  text += integer.text
  if (!hasFraction) {
    text += '元整'
  } else if (integer.pendingZero) {
    const decimal = convertFraction(fraction)
    text += decimal.startsWith('零') ? decimal : `零${decimal}`
  } else {
    text += `元${convertFraction(fraction)}`
  }
  return { ok: true, value: text }
}
