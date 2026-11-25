/**
 * @file schema 单测（边界值/枚举/颜色/长度）
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_MARGIN,
  MAX_SIZE,
  MIN_MARGIN,
  MIN_SIZE,
  qrContentSchema,
  qrStyleSchema,
  savePayloadSchema,
  setOutputDirPayloadSchema
} from './schema'

describe('qrStyleSchema', () => {
  const base = {
    errorCorrection: 'M' as const,
    size: MIN_SIZE,
    margin: MAX_MARGIN,
    foreground: '#000000',
    background: '#FFFFFF'
  }

  it('接受边界值与大小写颜色', () => {
    expect(qrStyleSchema.safeParse(base).success).toBe(true)
    expect(qrStyleSchema.safeParse({ ...base, size: MAX_SIZE, margin: MIN_MARGIN }).success).toBe(
      true
    )
  })

  it('拒绝越界尺寸/边距与非法颜色', () => {
    expect(qrStyleSchema.safeParse({ ...base, size: MIN_SIZE - 1 }).success).toBe(false)
    expect(qrStyleSchema.safeParse({ ...base, size: MAX_SIZE + 1 }).success).toBe(false)
    expect(qrStyleSchema.safeParse({ ...base, margin: MAX_MARGIN + 1 }).success).toBe(false)
    expect(qrStyleSchema.safeParse({ ...base, foreground: '#000' }).success).toBe(false)
    expect(qrStyleSchema.safeParse({ ...base, background: 'red' }).success).toBe(false)
  })
})

describe('qrContentSchema', () => {
  it('四种类型均可解析', () => {
    expect(qrContentSchema.safeParse({ type: 'text', value: 'hi' }).success).toBe(true)
    expect(qrContentSchema.safeParse({ type: 'url', value: 'https://a.b' }).success).toBe(true)
    expect(
      qrContentSchema.safeParse({
        type: 'wifi',
        wifi: { ssid: 'x', password: '', encryption: 'nopass', hidden: false }
      }).success
    ).toBe(true)
    expect(qrContentSchema.safeParse({ type: 'vcard', vcard: { name: '张三' } }).success).toBe(true)
  })

  it('拒绝未知类型与超长字段', () => {
    expect(qrContentSchema.safeParse({ type: 'geo', value: 'x' }).success).toBe(false)
    expect(qrContentSchema.safeParse({ type: 'text', value: 'x'.repeat(2001) }).success).toBe(false)
    expect(
      qrContentSchema.safeParse({
        type: 'wifi',
        wifi: { ssid: 'x'.repeat(65), password: '', encryption: 'WPA', hidden: false }
      }).success
    ).toBe(false)
  })
})

describe('savePayloadSchema / setOutputDirPayloadSchema', () => {
  it('接受合法保存入参', () => {
    expect(
      savePayloadSchema.safeParse({
        outputDir: 'C:\\out',
        baseName: 'qrcode',
        format: 'png',
        data: 'AAAA'
      }).success
    ).toBe(true)
  })

  it('拒绝空目录/空文件名/未知格式/空数据', () => {
    const valid = { outputDir: 'C:\\out', baseName: 'qrcode', format: 'png', data: 'AAAA' }
    expect(savePayloadSchema.safeParse({ ...valid, outputDir: '' }).success).toBe(false)
    expect(savePayloadSchema.safeParse({ ...valid, baseName: '' }).success).toBe(false)
    expect(savePayloadSchema.safeParse({ ...valid, format: 'jpg' }).success).toBe(false)
    expect(savePayloadSchema.safeParse({ ...valid, data: '' }).success).toBe(false)
  })

  it('输出目录记忆入参非空', () => {
    expect(setOutputDirPayloadSchema.safeParse({ outputDir: 'C:\\out' }).success).toBe(true)
    expect(setOutputDirPayloadSchema.safeParse({ outputDir: '' }).success).toBe(false)
  })
})
