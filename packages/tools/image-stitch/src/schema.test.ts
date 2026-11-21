/**
 * @file schema.test.ts IPC 契约 zod 校验（spec §5.1）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import { layoutSchema, MAX_IMAGES, splitPayloadSchema, stitchPayloadSchema } from './schema'

function layout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'vertical',
    sizeMode: 'first',
    fixedSize: 2000,
    columns: 3,
    gutter: 12,
    padding: 0,
    ...overrides
  }
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inputPaths: ['C:\\imgs\\a.png'],
    layout: layout(),
    encoder: 'png',
    quality: 90,
    bgColor: '#ffffff',
    ...overrides
  }
}

describe('layoutSchema', () => {
  it('接受合法参数（含固定尺寸/网格列数边界）', () => {
    expect(layoutSchema.safeParse(layout()).success).toBe(true)
    expect(layoutSchema.safeParse(layout({ fixedSize: 100, columns: 2 })).success).toBe(true)
    expect(layoutSchema.safeParse(layout({ fixedSize: 10_000, columns: 8 })).success).toBe(true)
  })

  it('固定尺寸与列数越界被拒', () => {
    expect(layoutSchema.safeParse(layout({ fixedSize: 99 })).success).toBe(false)
    expect(layoutSchema.safeParse(layout({ fixedSize: 10_001 })).success).toBe(false)
    expect(layoutSchema.safeParse(layout({ columns: 1 })).success).toBe(false)
    expect(layoutSchema.safeParse(layout({ columns: 9 })).success).toBe(false)
  })

  it('间距/外边距越界与小数为 int 拒绝', () => {
    expect(layoutSchema.safeParse(layout({ gutter: -1 })).success).toBe(false)
    expect(layoutSchema.safeParse(layout({ gutter: 101 })).success).toBe(false)
    expect(layoutSchema.safeParse(layout({ padding: 101 })).success).toBe(false)
    expect(layoutSchema.safeParse(layout({ gutter: 1.5 })).success).toBe(false)
  })

  it('mode/sizeMode 仅白名单值', () => {
    expect(layoutSchema.safeParse(layout({ mode: 'free' })).success).toBe(false)
    expect(layoutSchema.safeParse(layout({ sizeMode: 'min' })).success).toBe(false)
  })
})

describe('splitPayloadSchema（M40，spec §5.1）', () => {
  function split(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      inputPath: 'C:\\imgs\\long.png',
      mode: 'height',
      height: 1000,
      parts: 3,
      quality: 90,
      ...overrides
    }
  }

  it('合法载荷（outputDir 可省）', () => {
    expect(splitPayloadSchema.safeParse(split()).success).toBe(true)
    expect(splitPayloadSchema.safeParse(split({ outputDir: 'D:\\out' })).success).toBe(true)
    expect(splitPayloadSchema.safeParse(split({ mode: 'parts', parts: 8 })).success).toBe(true)
  })

  it('仅 PNG/JPG/WebP 输入', () => {
    expect(splitPayloadSchema.safeParse(split({ inputPath: 'C:\\a.gif' })).success).toBe(false)
    expect(splitPayloadSchema.safeParse(split({ inputPath: 'C:\\a.txt' })).success).toBe(false)
    expect(splitPayloadSchema.safeParse(split({ inputPath: 'C:\\a.jpeg' })).success).toBe(true)
    expect(splitPayloadSchema.safeParse(split({ inputPath: 'C:\\a.webp' })).success).toBe(true)
  })

  it('高度 50–30000、份数 2–50、质量 60–100', () => {
    expect(splitPayloadSchema.safeParse(split({ height: 49 })).success).toBe(false)
    expect(splitPayloadSchema.safeParse(split({ height: 30_001 })).success).toBe(false)
    expect(splitPayloadSchema.safeParse(split({ parts: 1 })).success).toBe(false)
    expect(splitPayloadSchema.safeParse(split({ parts: 51 })).success).toBe(false)
    expect(splitPayloadSchema.safeParse(split({ quality: 59 })).success).toBe(false)
    expect(splitPayloadSchema.safeParse(split({ quality: 101 })).success).toBe(false)
  })

  it('mode 仅 height/parts', () => {
    expect(splitPayloadSchema.safeParse(split({ mode: 'auto' })).success).toBe(false)
  })
})

describe('stitchPayloadSchema', () => {
  it('接受合法载荷（outputDir 可省）', () => {
    expect(stitchPayloadSchema.safeParse(payload()).success).toBe(true)
    expect(
      stitchPayloadSchema.safeParse(payload({ outputDir: 'D:\\out' })).success
    ).toBe(true)
  })

  it('空数组 / 超过 100 张被拒', () => {
    expect(stitchPayloadSchema.safeParse(payload({ inputPaths: [] })).success).toBe(false)
    const many = Array.from({ length: MAX_IMAGES + 1 }, (_, index) => `C:\\imgs\\${index}.png`)
    expect(stitchPayloadSchema.safeParse(payload({ inputPaths: many })).success).toBe(false)
  })

  it('非图片扩展名被拒', () => {
    expect(stitchPayloadSchema.safeParse(payload({ inputPaths: ['C:\\imgs\\a.gif'] })).success).toBe(
      false
    )
    expect(stitchPayloadSchema.safeParse(payload({ inputPaths: ['C:\\imgs\\a.txt'] })).success).toBe(
      false
    )
  })

  it('编码器白名单', () => {
    expect(stitchPayloadSchema.safeParse(payload({ encoder: 'bmp' })).success).toBe(false)
    expect(stitchPayloadSchema.safeParse(payload({ encoder: 'webp' })).success).toBe(true)
  })

  it('质量 60–100', () => {
    expect(stitchPayloadSchema.safeParse(payload({ quality: 59 })).success).toBe(false)
    expect(stitchPayloadSchema.safeParse(payload({ quality: 101 })).success).toBe(false)
    expect(stitchPayloadSchema.safeParse(payload({ quality: 60 })).success).toBe(true)
  })

  it('背景色需 #RRGGBB', () => {
    expect(stitchPayloadSchema.safeParse(payload({ bgColor: '#fff' })).success).toBe(false)
    expect(stitchPayloadSchema.safeParse(payload({ bgColor: 'red' })).success).toBe(false)
    expect(stitchPayloadSchema.safeParse(payload({ bgColor: '#A1B2C3' })).success).toBe(true)
  })
})
