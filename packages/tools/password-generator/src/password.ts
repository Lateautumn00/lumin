/**
 * @file 密码/随机生成纯函数（拒绝采样消除模偏差；随机源可注入便于确定性测试）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 密码生成（字符池构建 + 熵与强度）、UUID v4、随机字符串与随机整数；
 *              默认随机源为 Web Crypto `crypto.getRandomValues`，无第三方依赖。
 */

/** 随机源：返回指定长度的随机字节（测试注入固定序列） */
export type RandomSource = (length: number) => Uint8Array

/** 密码长度范围（含端点） */
export const PASSWORD_LENGTH_MIN = 4
export const PASSWORD_LENGTH_MAX = 128

/** 随机字符串长度范围（含端点） */
export const RANDOM_STRING_LENGTH_MIN = 1
export const RANDOM_STRING_LENGTH_MAX = 256

/** 随机整数取值跨度上限 */
export const RANDOM_INT_SPAN_MAX = 1_000_000

/** 易混淆字符（可一键排除） */
export const AMBIGUOUS_CHARS = '0OoIl1'

export const CHARSET_LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
export const CHARSET_UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const CHARSET_DIGITS = '0123456789'
export const CHARSET_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?/~'

/** 字符集选项（密码页签） */
export interface CharsetOptions {
  lowercase: boolean
  uppercase: boolean
  digits: boolean
  symbols: boolean
  excludeAmbiguous: boolean
  excludeChars: string
}

/** 密码生成选项 */
export interface PasswordOptions extends CharsetOptions {
  length: number
}

/** 强度档位 */
export type StrengthLevel = 'weak' | 'medium' | 'strong' | 'very-strong'

/** 强度展示信息 */
export interface StrengthInfo {
  level: StrengthLevel
  label: string
}

/** 密码生成结果 */
export interface PasswordResult {
  password: string
  poolSize: number
  entropyBits: number
  strength: StrengthLevel
}

/** 统一结果形状（失败带中文 message，UI 映射为结构化错误码） */
export type Result<T> = { ok: true; value: T } | { ok: false; message: string }

/** 随机字符串预设池 */
export const RANDOM_STRING_POOLS = [
  {
    id: 'alphanumeric',
    label: '字母 + 数字',
    pool: CHARSET_LOWERCASE + CHARSET_UPPERCASE + CHARSET_DIGITS
  },
  { id: 'letters', label: '仅字母', pool: CHARSET_LOWERCASE + CHARSET_UPPERCASE },
  { id: 'digits', label: '仅数字', pool: CHARSET_DIGITS },
  { id: 'hex', label: '十六进制', pool: '0123456789abcdef' }
] as const

/** 随机字符串预设池 id */
export type RandomPoolId = (typeof RANDOM_STRING_POOLS)[number]['id']

/**
 * 默认随机源：Web Crypto（浏览器 / Electron renderer / Node 18+ 全局可用）
 * @param length 所需字节数
 */
export function defaultRandomSource(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/**
 * 从字符池中采样一个下标（拒绝采样，避免 256 % bound 造成的模偏差）
 * @param bound 池大小（1–2^32）
 * @param random 随机源
 */
export function randomIntBelow(bound: number, random: RandomSource): number {
  if (!Number.isInteger(bound) || bound < 1 || bound > 0x1_0000_0000) {
    throw new RangeError('bound 必须为 1–2^32 的整数')
  }
  if (bound <= 256) {
    const limit = 256 - (256 % bound)
    for (;;) {
      const byte = random(1)[0]
      if (byte === undefined) throw new Error('随机源返回字节不足')
      if (byte < limit) return byte % bound
    }
  }
  const space = 0x1_0000_0000
  const limit = space - (space % bound)
  for (;;) {
    const bytes = random(4)
    const value = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0)
    if (value < limit) return value % bound
  }
}

/**
 * 构建字符池（按 小写→大写→数字→符号 顺序去重，再排除易混淆与自定义字符）
 * @param options 字符集选项
 */
export function buildCharset(options: CharsetOptions): string {
  let raw = ''
  if (options.lowercase) raw += CHARSET_LOWERCASE
  if (options.uppercase) raw += CHARSET_UPPERCASE
  if (options.digits) raw += CHARSET_DIGITS
  if (options.symbols) raw += CHARSET_SYMBOLS

  const excluded = new Set(options.excludeChars)
  if (options.excludeAmbiguous) {
    for (const char of AMBIGUOUS_CHARS) excluded.add(char)
  }

  const seen = new Set<string>()
  const chars: string[] = []
  for (const char of raw) {
    if (excluded.has(char) || seen.has(char)) continue
    seen.add(char)
    chars.push(char)
  }
  return chars.join('')
}

/**
 * 估算暴力破解熵（bits）= 长度 × log2(池大小)；池 < 2 或长度 ≤ 0 时为 0
 * @param length 长度
 * @param poolSize 字符池大小
 */
export function estimateEntropyBits(length: number, poolSize: number): number {
  if (length <= 0 || poolSize < 2) return 0
  return length * Math.log2(poolSize)
}

/**
 * 熵 → 强度档位（<40 弱 / <60 中 / <80 强 / ≥80 极强）
 * @param entropyBits 熵（bits）
 */
export function strengthOf(entropyBits: number): StrengthInfo {
  if (entropyBits < 40) return { level: 'weak', label: '弱' }
  if (entropyBits < 60) return { level: 'medium', label: '中' }
  if (entropyBits < 80) return { level: 'strong', label: '强' }
  return { level: 'very-strong', label: '极强' }
}

/** 用字符池均匀生成固定长度字符串（内部复用，池必须已校验非空） */
function sampleChars(length: number, pool: string, random: RandomSource): string {
  const chars: string[] = []
  for (let i = 0; i < length; i += 1) {
    chars.push(pool.charAt(randomIntBelow(pool.length, random)))
  }
  return chars.join('')
}

/**
 * 生成密码（字符池均匀采样，附带池大小、熵与强度）
 * @param options 长度与字符集选项
 * @param random 随机源（默认 Web Crypto）
 */
export function generatePassword(
  options: PasswordOptions,
  random: RandomSource = defaultRandomSource
): Result<PasswordResult> {
  if (
    !Number.isInteger(options.length) ||
    options.length < PASSWORD_LENGTH_MIN ||
    options.length > PASSWORD_LENGTH_MAX
  ) {
    return {
      ok: false,
      message: `密码长度需为 ${PASSWORD_LENGTH_MIN}–${PASSWORD_LENGTH_MAX} 的整数`
    }
  }
  const pool = buildCharset(options)
  if (pool.length === 0) {
    return { ok: false, message: '字符池为空：请至少启用一类字符，或减少排除字符' }
  }
  const password = sampleChars(options.length, pool, random)
  const entropyBits = estimateEntropyBits(options.length, pool.length)
  return {
    ok: true,
    value: {
      password,
      poolSize: pool.length,
      entropyBits,
      strength: strengthOf(entropyBits).level
    }
  }
}

/**
 * 生成 RFC 4122 UUID v4（第 6 字节高 4 位置 0100，第 8 字节高 2 位置 10）
 * @param random 随机源（默认 Web Crypto）
 */
export function generateUuidV4(random: RandomSource = defaultRandomSource): string {
  const source = random(16)
  if (source.length < 16) throw new Error('随机源至少需返回 16 字节')
  const bytes = new Uint8Array(source.subarray(0, 16))
  const sixth = bytes[6]
  const eighth = bytes[8]
  if (sixth === undefined || eighth === undefined) throw new Error('随机源至少需返回 16 字节')
  bytes[6] = (sixth & 0x0f) | 0x40
  bytes[8] = (eighth & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * 按预设 id 取字符池
 * @param id 预设 id
 */
export function poolOf(id: RandomPoolId): string {
  switch (id) {
    case 'alphanumeric':
      return CHARSET_LOWERCASE + CHARSET_UPPERCASE + CHARSET_DIGITS
    case 'letters':
      return CHARSET_LOWERCASE + CHARSET_UPPERCASE
    case 'digits':
      return CHARSET_DIGITS
    case 'hex':
      return '0123456789abcdef'
  }
}

/**
 * 生成随机字符串（字符池先去重）
 * @param length 长度 1–256
 * @param pool 字符池
 * @param random 随机源（默认 Web Crypto）
 */
export function generateRandomString(
  length: number,
  pool: string,
  random: RandomSource = defaultRandomSource
): Result<string> {
  if (
    !Number.isInteger(length) ||
    length < RANDOM_STRING_LENGTH_MIN ||
    length > RANDOM_STRING_LENGTH_MAX
  ) {
    return {
      ok: false,
      message: `长度需为 ${RANDOM_STRING_LENGTH_MIN}–${RANDOM_STRING_LENGTH_MAX} 的整数`
    }
  }
  const uniquePool = Array.from(new Set(pool)).join('')
  if (uniquePool.length === 0) return { ok: false, message: '字符集不能为空' }
  return { ok: true, value: sampleChars(length, uniquePool, random) }
}

/**
 * 生成闭区间随机整数 [min, max]
 * @param min 下界（含）
 * @param max 上界（含）
 * @param random 随机源（默认 Web Crypto）
 */
export function generateRandomInt(
  min: number,
  max: number,
  random: RandomSource = defaultRandomSource
): Result<number> {
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    return { ok: false, message: '上下界需为整数' }
  }
  if (min > max) return { ok: false, message: '下界不能大于上界' }
  const span = max - min + 1
  if (!Number.isSafeInteger(span) || span > RANDOM_INT_SPAN_MAX) {
    return { ok: false, message: `取值范围跨度不能超过 ${RANDOM_INT_SPAN_MAX}` }
  }
  return { ok: true, value: min + randomIntBelow(span, random) }
}
