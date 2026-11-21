/**
 * @file schema.ts 单测（扩展名归一 / 裁剪参数默认值 / 跨字段校验 / 三通道契约）
 * @author cuilanchao
 * @date 2026-11-21
 * @description spec §3：自由区域越界必须拒绝，枚举与数值范围由 zod 兜底
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_BATCH_FILES,
  configResultSchema,
  cropOptionsSchema,
  extensionOf,
  normalizeExtension,
  processPayloadSchema,
  setOutputDirPayloadSchema
} from './schema'

describe('normalizeExtension', () => {
  it('大小写不敏感、剥点、jpeg→jpg', () => {
    expect(normalizeExtension('.JPEG')).toBe('jpg')
    expect(normalizeExtension('PNG')).toBe('png')
    expect(normalizeExtension('.TiFf')).toBe('tiff')
  })

  it('白名单外返回 null', () => {
    expect(normalizeExtension('gif')).toBeNull()
    expect(normalizeExtension('')).toBeNull()
  })
})

describe('extensionOf', () => {
  it('提取路径扩展名（中文/空格路径）', () => {
    expect(extensionOf('E:\\我的 文档\\a.TIFF')).toBe('tiff')
    expect(extensionOf('/tmp/dir/x.WebP')).toBe('webp')
  })

  it('目录中的点/无扩展名/末尾点 → null', () => {
    expect(extensionOf('E:\\a.b\\file')).toBeNull()
    expect(extensionOf('README')).toBeNull()
    expect(extensionOf('broken.')).toBeNull()
  })
})

describe('cropOptionsSchema', () => {
  it('全字段合法（比例）', () => {
    const parsed = cropOptionsSchema.parse({
      mode: 'ratio',
      ratioW: 16,
      ratioH: 9,
      anchor: 'bottom-left',
      x: 0,
      y: 0,
      width: 100,
      height: 100
    })
    expect(parsed).toMatchObject({ mode: 'ratio', ratioW: 16, ratioH: 9, anchor: 'bottom-left' })
  })

  it('缺省字段回填默认值', () => {
    expect(cropOptionsSchema.parse({})).toEqual({
      mode: 'ratio',
      ratioW: 1,
      ratioH: 1,
      anchor: 'center',
      x: 0,
      y: 0,
      width: 100,
      height: 100
    })
  })

  it('自由区域合法边界（x+宽=100、y+高=100）', () => {
    expect(
      cropOptionsSchema.parse({ mode: 'free', x: 50, y: 50, width: 50, height: 50 })
    ).toMatchObject({ mode: 'free', x: 50, y: 50 })
  })

  it('自由区域越界 → 中文报错', () => {
    const overflowX = cropOptionsSchema.safeParse({
      mode: 'free',
      x: 60,
      y: 0,
      width: 50,
      height: 100
    })
    expect(overflowX.success).toBe(false)
    expect(overflowX.error?.issues[0]?.message).toBe('裁剪区域超出图片范围')

    expect(
      cropOptionsSchema.safeParse({ mode: 'free', x: 0, y: 80, width: 100, height: 30 }).success
    ).toBe(false)
  })

  it('枚举/整数/范围非法均拒绝', () => {
    expect(cropOptionsSchema.safeParse({ mode: 'zoom' }).success).toBe(false)
    expect(cropOptionsSchema.safeParse({ anchor: 'middle' }).success).toBe(false)
    expect(cropOptionsSchema.safeParse({ ratioW: 0 }).success).toBe(false)
    expect(cropOptionsSchema.safeParse({ ratioH: 101 }).success).toBe(false)
    expect(cropOptionsSchema.safeParse({ mode: 'free', width: 1.5 }).success).toBe(false)
  })
})

describe('processPayloadSchema', () => {
  it('合法批次', () => {
    const parsed = processPayloadSchema.parse({
      files: ['C:\\a.png'],
      outputDir: 'E:\\out',
      options: { mode: 'ratio', ratioW: 1, ratioH: 1, anchor: 'center' }
    })
    expect(parsed.files).toHaveLength(1)
    expect(parsed.options.width).toBe(100)
  })

  it('空列表 / 超上限 / 空目录 / 区域越界均拒绝', () => {
    expect(
      processPayloadSchema.safeParse({ files: [], outputDir: 'E:\\out', options: {} }).success
    ).toBe(false)
    expect(
      processPayloadSchema.safeParse({
        files: Array.from({ length: MAX_BATCH_FILES + 1 }, (_, i) => `C:\\${i}.png`),
        outputDir: 'E:\\out',
        options: {}
      }).success
    ).toBe(false)
    expect(
      processPayloadSchema.safeParse({ files: ['a.png'], outputDir: '', options: {} }).success
    ).toBe(false)
    expect(
      processPayloadSchema.safeParse({
        files: ['a.png'],
        outputDir: 'E:\\out',
        options: { mode: 'free', x: 90, y: 0, width: 20, height: 10 }
      }).success
    ).toBe(false)
  })
})

describe('config / set-output-dir', () => {
  it('config 形状固定', () => {
    expect(configResultSchema.parse({ outputDir: 'E:\\out' })).toEqual({ outputDir: 'E:\\out' })
  })

  it('set-output-dir 空值拒绝', () => {
    expect(setOutputDirPayloadSchema.safeParse({ outputDir: '' }).success).toBe(false)
    expect(setOutputDirPayloadSchema.safeParse({ outputDir: 'E:\\out' }).success).toBe(true)
  })
})
