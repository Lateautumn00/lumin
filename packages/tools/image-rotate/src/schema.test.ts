/**
 * @file schema.ts 单测（白名单归一 / IPC 契约约束）
 * @author cuilanchao
 * @date 2026-11-20
 * @description spec §3：扩展名归一、批量上限、旋转/翻转至少一项的 refine 兜底
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_BATCH_FILES,
  configResultSchema,
  extensionOf,
  normalizeExtension,
  processPayloadSchema,
  rotationSchema,
  setOutputDirPayloadSchema
} from './schema'

describe('normalizeExtension', () => {
  it('大小写/带点/jpeg 归一', () => {
    expect(normalizeExtension('JPG')).toBe('jpg')
    expect(normalizeExtension('.PNG')).toBe('png')
    expect(normalizeExtension('jpeg')).toBe('jpg')
    expect(normalizeExtension('Tiff')).toBe('tiff')
  })

  it('白名单外 → null', () => {
    expect(normalizeExtension('gif')).toBeNull()
    expect(normalizeExtension('avif')).toBeNull()
    expect(normalizeExtension('txt')).toBeNull()
    expect(normalizeExtension('')).toBeNull()
  })
})

describe('extensionOf', () => {
  it('取最后一个点之后的扩展名', () => {
    expect(extensionOf('C:\\photos\\a.JPG')).toBe('jpg')
    expect(extensionOf('/tmp/v1.2.3.png')).toBe('png')
    expect(extensionOf('C:\\photos\\a.jpeg')).toBe('jpg')
  })

  it('无扩展名 / 目录带点 / 路径分隔符之后的点 → null', () => {
    expect(extensionOf('C:\\photos\\noext')).toBeNull()
    expect(extensionOf('C:\\my.photos\\file')).toBeNull()
    expect(extensionOf('C:\\photos\\.hidden')).toBeNull()
  })
})

describe('processPayloadSchema', () => {
  const valid = {
    files: ['C:\\a.png'],
    outputDir: 'C:\\out',
    options: { rotation: '90', flip: 'horizontal' }
  }

  it('合法 payload 通过', () => {
    expect(processPayloadSchema.safeParse(valid).success).toBe(true)
  })

  it('空文件列表 / 超上限 / 空输出目录 → 拒绝', () => {
    expect(processPayloadSchema.safeParse({ ...valid, files: [] }).success).toBe(false)
    const many = Array.from({ length: MAX_BATCH_FILES + 1 }, (_, i) => `C:\\${i}.png`)
    expect(processPayloadSchema.safeParse({ ...valid, files: many }).success).toBe(false)
    expect(processPayloadSchema.safeParse({ ...valid, outputDir: '' }).success).toBe(false)
  })

  it('旋转与翻转均为 none → refine 拒绝并给中文文案', () => {
    const result = processPayloadSchema.safeParse({
      ...valid,
      options: { rotation: 'none', flip: 'none' }
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('请选择旋转角度或翻转方式')
    }
  })

  it('非法枚举 → 拒绝', () => {
    expect(rotationSchema.safeParse('45').success).toBe(false)
    expect(
      processPayloadSchema.safeParse({ ...valid, options: { rotation: '90', flip: 'diagonal' } })
        .success
    ).toBe(false)
  })
})

describe('config / set-output-dir 契约', () => {
  it('config 回包必须含 outputDir', () => {
    expect(configResultSchema.safeParse({ outputDir: 'C:\\out' }).success).toBe(true)
    expect(configResultSchema.safeParse({}).success).toBe(false)
  })

  it('outputDir 非空', () => {
    expect(setOutputDirPayloadSchema.safeParse({ outputDir: '' }).success).toBe(false)
    expect(setOutputDirPayloadSchema.safeParse({ outputDir: 'C:\\out' }).success).toBe(true)
  })
})
