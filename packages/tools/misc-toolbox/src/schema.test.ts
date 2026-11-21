import { describe, expect, it } from 'vitest'

import {
  captureDisplayPayloadSchema,
  captureDisplayResultSchema,
  ipv4AddressSchema,
  ipv4CidrSchema,
  prefixLengthSchema
} from './schema'

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

describe('屏幕标尺截屏契约', () => {
  const validResult = {
    displayId: '1',
    displayName: '主显示器',
    width: 1920,
    height: 1080,
    scaleFactor: 1.5,
    dataUrl: 'data:image/png;base64,AAAA',
    displays: [{ id: '1', label: '主显示器' }]
  }

  it('入参 displayId 可省略、不可为空串', () => {
    expect(captureDisplayPayloadSchema.safeParse({}).success).toBe(true)
    expect(captureDisplayPayloadSchema.safeParse({ displayId: '2' }).success).toBe(true)
    expect(captureDisplayPayloadSchema.safeParse({ displayId: '' }).success).toBe(false)
  })

  it('接受完整回包', () => {
    expect(captureDisplayResultSchema.safeParse(validResult).success).toBe(true)
  })

  it('拒绝非 PNG dataURL / 非正尺寸 / 无显示器 / 非正缩放', () => {
    expect(
      captureDisplayResultSchema.safeParse({ ...validResult, dataUrl: 'data:image/jpeg;base64,AA' })
        .success
    ).toBe(false)
    expect(captureDisplayResultSchema.safeParse({ ...validResult, width: 0 }).success).toBe(false)
    expect(captureDisplayResultSchema.safeParse({ ...validResult, scaleFactor: 0 }).success).toBe(
      false
    )
    expect(captureDisplayResultSchema.safeParse({ ...validResult, displays: [] }).success).toBe(
      false
    )
  })

  it('显示器选项必须严格为 id + label', () => {
    expect(
      captureDisplayResultSchema.safeParse({
        ...validResult,
        displays: [{ id: '1', label: '主显示器', extra: true }]
      }).success
    ).toBe(false)
  })
})
