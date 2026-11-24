import { describe, expect, it } from 'vitest'

import {
  amountToChinese,
  maskEmail,
  maskIdCard,
  maskName,
  maskPhone,
  validateIdCard
} from './chinese-info'

describe('数据脱敏四规则', () => {
  it('手机号命中：1[3-9] 开头 11 位保前 3 后 4', () => {
    expect(maskPhone('13812345678')).toBe('138****5678')
    expect(maskPhone('  19900001111  ')).toBe('199****1111')
  })

  it('手机号未命中：10 位与非 1[3-9] 开头', () => {
    expect(maskPhone('1381234567')).toBeNull()
    expect(maskPhone('12812345678')).toBeNull()
    expect(maskPhone('')).toBeNull()
  })

  it('身份证命中：前 4 后 4 中间 10 星', () => {
    expect(maskIdCard('11010519491231002X')).toBe('1101**********002X')
    expect(maskIdCard('11010519491231002x')).toBe('1101**********002X')
  })

  it('身份证未命中：11 位与含非数字', () => {
    expect(maskIdCard('11010519491')).toBeNull()
    expect(maskIdCard('1101051949123100A')).toBeNull()
  })

  it('邮箱命中：首字符 + *** + 域名保留', () => {
    expect(maskEmail('zhang@example.com')).toBe('z***@example.com')
    expect(maskEmail(' a@b.cn ')).toBe('a***@b.cn')
  })

  it('邮箱未命中：无 @、无域名点号与空串', () => {
    expect(maskEmail('plain-text')).toBeNull()
    expect(maskEmail('a@b')).toBeNull()
    expect(maskEmail('@example.com')).toBeNull()
    expect(maskEmail('')).toBeNull()
  })

  it('姓名命中：保留首字其余星号', () => {
    expect(maskName('张三')).toBe('张*')
    expect(maskName('欧阳锋')).toBe('欧**')
  })

  it('姓名未命中：单字、含数字与含 @', () => {
    expect(maskName('张')).toBeNull()
    expect(maskName('13812345678')).toBeNull()
    expect(maskName('zhang@example.com')).toBeNull()
    expect(maskName('')).toBeNull()
  })
})

describe('身份证校验（GB 11643）', () => {
  it('X 尾合法向量：通过并输出出生日期与性别', () => {
    expect(validateIdCard('11010519491231002X')).toEqual({
      ok: true,
      value: { birthDate: '1949-12-31', gender: '女' }
    })
  })

  it('小写 x 与含空格输入自动归一化后通过', () => {
    expect(validateIdCard('11010519491231002x')).toEqual({
      ok: true,
      value: { birthDate: '1949-12-31', gender: '女' }
    })
    expect(validateIdCard(' 110105 19491231002X ')).toEqual({
      ok: true,
      value: { birthDate: '1949-12-31', gender: '女' }
    })
  })

  it('顺序码奇男偶女：奇数输出男', () => {
    expect(validateIdCard('110105194912310011')).toEqual({
      ok: true,
      value: { birthDate: '1949-12-31', gender: '男' }
    })
  })

  it('11 位 → MT_ID_INVALID（位数不符）', () => {
    const result = validateIdCard('11010519491')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('MT_ID_INVALID')
    expect(result.error.message).toBe('身份证号格式无效')
    expect(result.error.detail).toBe('需 18 位，当前 11 位')
  })

  it('15 位 → MT_ID_LEGACY（V1 仅支持 18 位）', () => {
    const result = validateIdCard('110105491231002')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('MT_ID_LEGACY')
    expect(result.error.message).toBe('V1 仅支持 18 位')
  })

  it('校验位错误 → MT_ID_CHECKSUM', () => {
    const result = validateIdCard('110105194912310021')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('MT_ID_CHECKSUM')
    expect(result.error.message).toBe('身份证校验位不通过')
  })

  it('18 位但字符非法 / 出生日期非法 → MT_ID_INVALID', () => {
    const charResult = validateIdCard('110105A9491231002X')
    expect(charResult.ok).toBe(false)
    if (!charResult.ok) {
      expect(charResult.error.code).toBe('MT_ID_INVALID')
      expect(charResult.error.detail).toBe('仅允许数字，末位可为 X')
    }
    const dateResult = validateIdCard('11010519901301001X')
    expect(dateResult.ok).toBe(false)
    if (!dateResult.ok) {
      expect(dateResult.error.code).toBe('MT_ID_INVALID')
      expect(dateResult.error.detail).toBe('出生日期无效')
    }
  })
})

describe('金额大写（12 锚点）', () => {
  it('0 与 0.5', () => {
    expect(amountToChinese('0')).toEqual({ ok: true, value: '零元整' })
    expect(amountToChinese('0.5')).toEqual({ ok: true, value: '零元伍角' })
  })

  it('10 末尾整', () => {
    expect(amountToChinese('10')).toEqual({ ok: true, value: '壹拾元整' })
  })

  it('100.07 角为零补零（小数末零）', () => {
    expect(amountToChinese('100.07')).toEqual({ ok: true, value: '壹佰元零柒分' })
  })

  it('1001 中间整零', () => {
    expect(amountToChinese('1001')).toEqual({ ok: true, value: '壹仟零壹元整' })
  })

  it('10000 万位整', () => {
    expect(amountToChinese('10000')).toEqual({ ok: true, value: '壹万元整' })
  })

  it('1000000.25 整数末节为零以零衔接小数', () => {
    expect(amountToChinese('1000000.25')).toEqual({ ok: true, value: '壹佰万零贰角伍分' })
  })

  it('1234567890.99 亿级与角分齐全', () => {
    expect(amountToChinese('1234567890.99')).toEqual({
      ok: true,
      value: '壹拾贰亿叁仟肆佰伍拾陆万柒仟捌佰玖拾元玖角玖分'
    })
  })

  it('-1234.56 负号前缀', () => {
    expect(amountToChinese('-1234.56')).toEqual({
      ok: true,
      value: '负壹仟贰佰叁拾肆元伍角陆分'
    })
  })

  it('2000000000000000（16 位）万亿级', () => {
    expect(amountToChinese('2000000000000000')).toEqual({
      ok: true,
      value: '贰仟万亿元整'
    })
  })

  it('末尾整：分角皆无以整结尾', () => {
    expect(amountToChinese('100')).toEqual({ ok: true, value: '壹佰元整' })
    expect(amountToChinese('100.00')).toEqual({ ok: true, value: '壹佰元整' })
  })

  it('小数末零：分位为零省略分', () => {
    expect(amountToChinese('10.50')).toEqual({ ok: true, value: '壹拾元伍角' })
    expect(amountToChinese('10.05')).toEqual({ ok: true, value: '壹拾元零伍分' })
  })

  it('千分位自动剥离与前导零归一', () => {
    expect(amountToChinese('1,234.56')).toEqual({
      ok: true,
      value: '壹仟贰佰叁拾肆元伍角陆分'
    })
    expect(amountToChinese('007')).toEqual({ ok: true, value: '柒元整' })
  })

  it('非法输入 → MT_AMOUNT_INVALID', () => {
    for (const input of ['', 'abc', '1.234', '.5', '5.', '+10', '12345678901234567']) {
      const result = amountToChinese(input)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.error.code).toBe('MT_AMOUNT_INVALID')
      expect(result.error.message).toBe('金额格式无效')
    }
    const tooLong = amountToChinese('12345678901234567')
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) expect(tooLong.error.detail).toBe('整数部分不能超过 16 位')
  })
})
