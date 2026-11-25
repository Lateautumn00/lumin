import { describe, expect, it } from 'vitest'

import {
  AMBIGUOUS_CHARS,
  CHARSET_DIGITS,
  CHARSET_LOWERCASE,
  CHARSET_SYMBOLS,
  PASSWORD_LENGTH_MAX,
  RANDOM_INT_SPAN_MAX,
  RANDOM_STRING_POOLS,
  buildCharset,
  defaultRandomSource,
  estimateEntropyBits,
  generatePassword,
  generateRandomInt,
  generateRandomString,
  generateUuidV4,
  poolOf,
  randomIntBelow,
  strengthOf,
  type CharsetOptions,
  type RandomSource
} from './password'

const ALL_SETS: CharsetOptions = {
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
  excludeChars: ''
}

/** 固定字节随机源 */
function fixedSource(fill: number): RandomSource {
  return (length) => {
    const bytes = new Uint8Array(length)
    bytes.fill(fill)
    return bytes
  }
}

/** 按序消费字节的随机源（耗尽后补 0） */
function byteSequence(values: number[]): RandomSource {
  let index = 0
  return (length) => {
    const bytes = new Uint8Array(length)
    for (let i = 0; i < length; i += 1) {
      const value = values[index]
      bytes[i] = value === undefined ? 0 : value
      index += 1
    }
    return bytes
  }
}

describe('buildCharset', () => {
  it('按小写→大写→数字→符号拼接并去重', () => {
    const pool = buildCharset(ALL_SETS)
    expect(pool.length).toBe(26 + 26 + 10 + 27)
    expect(pool.startsWith(CHARSET_LOWERCASE)).toBe(true)
    expect(new Set(pool).size).toBe(pool.length)
    expect(pool).toContain('~')
    expect(pool).not.toContain('"')
  })

  it('仅启用部分字符集', () => {
    expect(buildCharset({ ...ALL_SETS, lowercase: false, uppercase: false, symbols: false })).toBe(
      CHARSET_DIGITS
    )
    expect(buildCharset({ ...ALL_SETS, uppercase: false, digits: false, symbols: false })).toBe(
      CHARSET_LOWERCASE
    )
  })

  it('排除易混淆字符', () => {
    const pool = buildCharset({ ...ALL_SETS, excludeAmbiguous: true })
    expect(pool.length).toBe(89 - AMBIGUOUS_CHARS.length)
    for (const char of AMBIGUOUS_CHARS) expect(pool).not.toContain(char)
  })

  it('自定义排除字符与空字符池', () => {
    expect(buildCharset({ ...ALL_SETS, excludeChars: 'abc' }).length).toBe(89 - 3)
    expect(
      buildCharset({
        ...ALL_SETS,
        lowercase: false,
        uppercase: false,
        digits: true,
        symbols: false,
        excludeChars: CHARSET_DIGITS
      })
    ).toBe('')
  })

  it('剔除符号集外的引号与反斜杠', () => {
    expect(CHARSET_SYMBOLS).not.toContain('"')
    expect(CHARSET_SYMBOLS).not.toContain("'")
    expect(CHARSET_SYMBOLS).not.toContain('\\')
  })
})

describe('randomIntBelow', () => {
  it('拒绝采样跳过造成模偏差的字节', () => {
    // bound=10 → limit=250；250/251 被拒，7 命中
    expect(randomIntBelow(10, byteSequence([250, 251, 7]))).toBe(7)
  })

  it('边界 1 与 256', () => {
    expect(randomIntBelow(1, fixedSource(255))).toBe(0)
    expect(randomIntBelow(256, fixedSource(255))).toBe(255)
  })

  it('支持大于 256 的 bound（4 字节拒绝采样）', () => {
    expect(randomIntBelow(1000, byteSequence([0x00, 0x00, 0x03, 0xe8]))).toBe(0)
    expect(randomIntBelow(1000, byteSequence([0x00, 0x00, 0x03, 0xe9]))).toBe(1)
  })

  it('非法 bound 抛 RangeError', () => {
    expect(() => randomIntBelow(0, fixedSource(0))).toThrow(RangeError)
    expect(() => randomIntBelow(1.5, fixedSource(0))).toThrow(RangeError)
    expect(() => randomIntBelow(0x1_0000_0001, fixedSource(0))).toThrow(RangeError)
  })

  it('随机源字节不足抛错', () => {
    expect(() => randomIntBelow(10, () => new Uint8Array(0))).toThrow('随机源返回字节不足')
  })
})

describe('estimateEntropyBits / strengthOf', () => {
  it('熵 = 长度 × log2(池大小)', () => {
    expect(estimateEntropyBits(16, 2)).toBe(16)
    expect(estimateEntropyBits(16, 89)).toBeCloseTo(16 * Math.log2(89), 6)
  })

  it('长度或池大小无效时为 0', () => {
    expect(estimateEntropyBits(0, 89)).toBe(0)
    expect(estimateEntropyBits(16, 1)).toBe(0)
  })

  it('强度分档边界：<40 弱 / <60 中 / <80 强 / ≥80 极强', () => {
    expect(strengthOf(0)).toEqual({ level: 'weak', label: '弱' })
    expect(strengthOf(39.9).level).toBe('weak')
    expect(strengthOf(40)).toEqual({ level: 'medium', label: '中' })
    expect(strengthOf(59.9).level).toBe('medium')
    expect(strengthOf(60)).toEqual({ level: 'strong', label: '强' })
    expect(strengthOf(79.9).level).toBe('strong')
    expect(strengthOf(80)).toEqual({ level: 'very-strong', label: '极强' })
    expect(strengthOf(200).level).toBe('very-strong')
  })
})

describe('generatePassword', () => {
  it('长度越界或非整数返回失败', () => {
    const base = { ...ALL_SETS, length: 16 }
    expect(generatePassword({ ...base, length: 3 }).ok).toBe(false)
    expect(generatePassword({ ...base, length: PASSWORD_LENGTH_MAX + 1 }).ok).toBe(false)
    expect(generatePassword({ ...base, length: 4.5 }).ok).toBe(false)
  })

  it('未选字符集或排除后为空返回失败', () => {
    const options = {
      lowercase: false,
      uppercase: false,
      digits: false,
      symbols: false,
      excludeAmbiguous: false,
      excludeChars: '',
      length: 8
    }
    expect(generatePassword(options).ok).toBe(false)
    expect(
      generatePassword({
        ...options,
        lowercase: true,
        excludeChars: CHARSET_LOWERCASE
      }).ok
    ).toBe(false)
  })

  it('确定性随机源下产出可断言结果', () => {
    const result = generatePassword(
      { ...ALL_SETS, length: 8, uppercase: false, digits: false, symbols: false },
      fixedSource(0)
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.password).toBe('aaaaaaaa')
    expect(result.value.poolSize).toBe(26)
    expect(result.value.entropyBits).toBeCloseTo(8 * Math.log2(26), 6)
    expect(result.value.strength).toBe('weak')
  })

  it('全字符集首字符为池首字符', () => {
    const result = generatePassword({ ...ALL_SETS, length: 16 }, fixedSource(0))
    expect(result.ok && result.value.password.startsWith('a')).toBe(true)
    expect(result.ok && result.value.password.length).toBe(16)
  })
})

describe('generateUuidV4', () => {
  it('固定 0 字节产出合法 v4 形状', () => {
    expect(generateUuidV4(fixedSource(0))).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('固定 0xff 字节设置版本位与变体位', () => {
    expect(generateUuidV4(fixedSource(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })

  it('顺序字节产出可断言的字符串', () => {
    const source = (length: number): Uint8Array => Uint8Array.from({ length }, (_, index) => index)
    expect(generateUuidV4(source)).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
  })

  it('随机源字节不足抛错', () => {
    expect(() => generateUuidV4(() => new Uint8Array(8))).toThrow('随机源至少需返回 16 字节')
  })
})

describe('poolOf', () => {
  it('四个预设池长度正确', () => {
    expect(poolOf('alphanumeric').length).toBe(62)
    expect(poolOf('letters').length).toBe(52)
    expect(poolOf('digits')).toBe(CHARSET_DIGITS)
    expect(poolOf('hex').length).toBe(16)
    const ids = RANDOM_STRING_POOLS.map((item) => item.id)
    expect(new Set(ids).size).toBe(4)
  })
})

describe('generateRandomString', () => {
  it('长度越界返回失败', () => {
    expect(generateRandomString(0, CHARSET_DIGITS).ok).toBe(false)
    expect(generateRandomString(257, CHARSET_DIGITS).ok).toBe(false)
    expect(generateRandomString(2.5, CHARSET_DIGITS).ok).toBe(false)
  })

  it('空字符池返回失败', () => {
    expect(generateRandomString(8, '')).toEqual({ ok: false, message: '字符集不能为空' })
  })

  it('确定性随机源下产出可断言结果', () => {
    expect(generateRandomString(5, 'abc', fixedSource(0))).toEqual({
      ok: true,
      value: 'aaaaa'
    })
  })

  it('字符池先去重再采样', () => {
    expect(generateRandomString(3, 'aab', fixedSource(1))).toEqual({
      ok: true,
      value: 'bbb'
    })
  })
})

describe('generateRandomInt', () => {
  it('闭区间边界命中', () => {
    expect(generateRandomInt(1, 10, fixedSource(0))).toEqual({ ok: true, value: 1 })
    expect(generateRandomInt(1, 10, fixedSource(9))).toEqual({ ok: true, value: 10 })
    expect(generateRandomInt(-5, 5, fixedSource(0))).toEqual({ ok: true, value: -5 })
  })

  it('拒绝采样后继续取值', () => {
    expect(generateRandomInt(1, 10, byteSequence([250, 5]))).toEqual({ ok: true, value: 6 })
  })

  it('非法上下界返回失败', () => {
    expect(generateRandomInt(10, 1, fixedSource(0)).ok).toBe(false)
    expect(generateRandomInt(0.5, 5, fixedSource(0)).ok).toBe(false)
    expect(generateRandomInt(0, RANDOM_INT_SPAN_MAX, fixedSource(0)).ok).toBe(false)
  })
})

describe('defaultRandomSource', () => {
  it('返回请求长度的随机字节', () => {
    const bytes = defaultRandomSource(16)
    expect(bytes.length).toBe(16)
    expect(bytes.some((byte) => byte !== 0)).toBe(true)
  })
})
