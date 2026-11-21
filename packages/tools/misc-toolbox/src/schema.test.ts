import { describe, expect, it } from 'vitest'

import { ipv4AddressSchema, ipv4CidrSchema, prefixLengthSchema } from './schema'

describe('schema', () => {
  it('接受合法 CIDR 解析结果', () => {
    expect(
      ipv4CidrSchema.safeParse({ address: 0xc0a80100, prefix: 24, normalized: true }).success
    ).toBe(true)
    expect(ipv4CidrSchema.safeParse({ address: 0, prefix: 0, normalized: false }).success).toBe(
      true
    )
  })

  it('地址必须为 0–4294967295 的整数', () => {
    expect(ipv4AddressSchema.safeParse(-1).success).toBe(false)
    expect(ipv4AddressSchema.safeParse(0x100000000).success).toBe(false)
    expect(ipv4AddressSchema.safeParse(1.5).success).toBe(false)
  })

  it('前缀长度必须为 0–32 的整数', () => {
    expect(prefixLengthSchema.safeParse(0).success).toBe(true)
    expect(prefixLengthSchema.safeParse(32).success).toBe(true)
    expect(prefixLengthSchema.safeParse(33).success).toBe(false)
    expect(prefixLengthSchema.safeParse(-1).success).toBe(false)
    expect(prefixLengthSchema.safeParse(24.5).success).toBe(false)
  })

  it('拒绝缺字段与错误类型', () => {
    expect(ipv4CidrSchema.safeParse({ address: 1, prefix: 24 }).success).toBe(false)
    expect(ipv4CidrSchema.safeParse({ address: '1', prefix: 24, normalized: false }).success).toBe(
      false
    )
  })
})
