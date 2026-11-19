/**
 * @file schema 单测（输入白名单/比例框/文本长度）
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_TEXT_LENGTH,
  ocrTextLineSchema,
  recognizePayloadSchema,
  recognizeResultSchema,
  saveTxtPayloadSchema
} from './schema'

describe('recognizePayloadSchema', () => {
  it('接受 png/jpg/jpeg/webp（大小写不敏感）与中文/空格路径', () => {
    for (const path of [
      'C:\\图片 目录\\截图.PNG',
      'a.JPG',
      'a.jpeg',
      'a.webp',
      'D:/x/y.JpEg'
    ]) {
      expect(recognizePayloadSchema.safeParse({ inputPath: path }).success).toBe(true)
    }
  })

  it('拒绝 PDF 与其他扩展名', () => {
    for (const path of ['a.pdf', 'a.gif', 'a.txt', '']) {
      expect(recognizePayloadSchema.safeParse({ inputPath: path }).success).toBe(false)
    }
  })
})

describe('ocrTextLineSchema', () => {
  it('接受图内比例框', () => {
    expect(
      ocrTextLineSchema.safeParse({ text: '你好', x: 0.1, y: 0.2, width: 0.3, height: 0.1 })
        .success
    ).toBe(true)
  })

  it('拒绝越界框与空文本', () => {
    expect(
      ocrTextLineSchema.safeParse({ text: 'x', x: 0.8, y: 0, width: 0.3, height: 0.1 }).success
    ).toBe(false)
    expect(
      ocrTextLineSchema.safeParse({ text: '', x: 0, y: 0, width: 0.1, height: 0.1 }).success
    ).toBe(false)
  })
})

describe('recognizeResultSchema', () => {
  it('至少一行且尺寸为正整数', () => {
    const line = { text: 'a', x: 0, y: 0, width: 0.1, height: 0.1 }
    expect(recognizeResultSchema.safeParse({ width: 10, height: 20, lines: [line] }).success).toBe(
      true
    )
    expect(recognizeResultSchema.safeParse({ width: 10, height: 20, lines: [] }).success).toBe(false)
    expect(recognizeResultSchema.safeParse({ width: 0, height: 20, lines: [line] }).success).toBe(
      false
    )
  })
})

describe('saveTxtPayloadSchema', () => {
  const valid = { outputDir: 'C:\\导出 目录', inputPath: 'C:\\a.png', text: 'hello' }

  it('接受合法载荷', () => {
    expect(saveTxtPayloadSchema.safeParse(valid).success).toBe(true)
  })

  it('拒绝空目录/非图片/空文本/超长文本', () => {
    expect(saveTxtPayloadSchema.safeParse({ ...valid, outputDir: '' }).success).toBe(false)
    expect(saveTxtPayloadSchema.safeParse({ ...valid, inputPath: 'a.pdf' }).success).toBe(false)
    expect(saveTxtPayloadSchema.safeParse({ ...valid, text: '' }).success).toBe(false)
    expect(
      saveTxtPayloadSchema.safeParse({ ...valid, text: 'x'.repeat(MAX_TEXT_LENGTH + 1) }).success
    ).toBe(false)
  })
})
