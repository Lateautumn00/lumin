/**
 * @file schema.test.ts IPC 契约单测（白名单/范围/必填/联合类型）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import {
  configResultSchema,
  MAX_IMAGES,
  setOutputDirPayloadSchema,
  watermarkPayloadSchema,
  watermarkSchema,
  type TextWatermark
} from './schema'

/** 合法文字水印 */
function textWatermark(overrides: Partial<TextWatermark> = {}): TextWatermark {
  return {
    type: 'text',
    text: '内部资料',
    color: '#ffffff',
    sizePct: 8,
    opacity: 30,
    rotation: 0,
    position: 'bottom-right',
    marginPct: 3,
    tile: false,
    ...overrides
  }
}

describe('watermarkPayloadSchema', () => {
  it('合法文字水印通过', () => {
    const parsed = watermarkPayloadSchema.parse({
      inputPaths: ['C:\\imgs\\a.png', 'C:\\imgs\\b.JPG'],
      watermark: textWatermark()
    })
    expect(parsed.inputPaths).toHaveLength(2)
    expect(parsed.outputDir).toBeUndefined()
  })

  it('空列表 / 超上限 / 非白名单扩展名拒绝', () => {
    expect(() =>
      watermarkPayloadSchema.parse({ inputPaths: [], watermark: textWatermark() })
    ).toThrow()
    const tooMany = Array.from({ length: MAX_IMAGES + 1 }, (_, index) => `a${index}.png`)
    expect(() =>
      watermarkPayloadSchema.parse({ inputPaths: tooMany, watermark: textWatermark() })
    ).toThrow()
    expect(() =>
      watermarkPayloadSchema.parse({ inputPaths: ['a.gif'], watermark: textWatermark() })
    ).toThrow()
    expect(() =>
      watermarkPayloadSchema.parse({
        inputPaths: ['a.png'],
        watermark: textWatermark(),
        outputDir: ''
      })
    ).toThrow()
  })

  it('文字内容为空/超长/颜色非法拒绝', () => {
    expect(() => watermarkSchema.parse(textWatermark({ text: '   ' }))).toThrow()
    expect(() => watermarkSchema.parse(textWatermark({ text: 'x'.repeat(101) }))).toThrow()
    expect(() => watermarkSchema.parse(textWatermark({ color: 'red' }))).toThrow()
    expect(() => watermarkSchema.parse(textWatermark({ text: 'x'.repeat(100) }))).not.toThrow()
  })

  it('几何参数越界拒绝', () => {
    for (const patch of [
      { sizePct: 1 },
      { sizePct: 51 },
      { opacity: 4 },
      { opacity: 101 },
      { rotation: -181 },
      { rotation: 181 },
      { marginPct: -1 },
      { marginPct: 21 }
    ]) {
      expect(() => watermarkSchema.parse(textWatermark(patch))).toThrow()
    }
    expect(() => watermarkSchema.parse({ ...textWatermark(), position: 'top-middle' })).toThrow()
    expect(() => watermarkSchema.parse({ ...textWatermark(), tile: undefined })).toThrow()
  })

  it('图片水印必须提供合法路径', () => {
    const base = {
      type: 'image' as const,
      watermarkPath: 'C:\\logo.png',
      sizePct: 20,
      opacity: 50,
      rotation: -30,
      position: 'center' as const,
      marginPct: 0,
      tile: true
    }
    expect(watermarkSchema.parse(base)).toMatchObject({ type: 'image' })
    expect(() => watermarkSchema.parse({ ...base, watermarkPath: '' })).toThrow()
    expect(() => watermarkSchema.parse({ ...base, watermarkPath: 'C:\\logo.svg' })).toThrow()
    expect(() => watermarkSchema.parse({ ...base, type: 'video' })).toThrow()
  })
})

describe('同步通道契约', () => {
  it('setOutputDirPayloadSchema 拒绝空目录', () => {
    expect(setOutputDirPayloadSchema.parse({ outputDir: 'D:\\out' })).toEqual({
      outputDir: 'D:\\out'
    })
    expect(() => setOutputDirPayloadSchema.parse({ outputDir: '' })).toThrow()
    expect(() => setOutputDirPayloadSchema.parse({})).toThrow()
  })

  it('configResultSchema 拒绝空目录', () => {
    expect(configResultSchema.parse({ outputDir: 'D:\\out' })).toEqual({ outputDir: 'D:\\out' })
    expect(() => configResultSchema.parse({ outputDir: '' })).toThrow()
  })
})
