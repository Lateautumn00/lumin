/**
 * @file schema 单测（输入白名单/数量上限/去重/导出载荷）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import {
  exportPayloadSchema,
  MAX_BATCH_FILES,
  recognizePayloadSchema,
  recognizeResultSchema
} from './schema'

describe('recognizePayloadSchema', () => {
  it('接受 1–50 个图片/PDF（大小写不敏感、中文/空格路径）', () => {
    const paths = Array.from(
      { length: MAX_BATCH_FILES },
      (_, index) => `C:\\图片 目录\\第${index}张.PNG`
    )
    expect(recognizePayloadSchema.safeParse({ inputPaths: paths }).success).toBe(true)
    for (const path of ['a.JPG', 'a.jpeg', 'D:/x/y.JpEg', 'a.webp', 'a.PDF', 'a.Pdf']) {
      expect(recognizePayloadSchema.safeParse({ inputPaths: [path] }).success).toBe(true)
    }
  })

  it('拒绝空数组、超过 50 个、GIF/其他扩展名与重复路径', () => {
    expect(recognizePayloadSchema.safeParse({ inputPaths: [] }).success).toBe(false)
    const tooMany = Array.from({ length: MAX_BATCH_FILES + 1 }, (_, index) => `${index}.png`)
    expect(recognizePayloadSchema.safeParse({ inputPaths: tooMany }).success).toBe(false)
    expect(recognizePayloadSchema.safeParse({ inputPaths: ['a.gif'] }).success).toBe(false)
    expect(recognizePayloadSchema.safeParse({ inputPaths: ['a.txt'] }).success).toBe(false)
    expect(recognizePayloadSchema.safeParse({ inputPaths: ['a.png', 'a.png'] }).success).toBe(false)
  })
})

describe('recognizeResultSchema', () => {
  it('接受成功/失败混合结果与多页 pageCount', () => {
    expect(
      recognizeResultSchema.safeParse({
        items: [
          { status: 'done', inputPath: 'a.png', width: 10, height: 10, text: '文字' },
          {
            status: 'done',
            inputPath: 'b.pdf',
            width: 893,
            height: 1263,
            pageCount: 3,
            text: '第 1 页'
          },
          {
            status: 'failed',
            inputPath: 'c.png',
            error: { code: 'OCR_NO_TEXT', message: '无文字' }
          }
        ]
      }).success
    ).toBe(true)
  })

  it('拒绝空结果、缺字段、非法 pageCount', () => {
    expect(recognizeResultSchema.safeParse({ items: [] }).success).toBe(false)
    expect(
      recognizeResultSchema.safeParse({
        items: [{ status: 'done', inputPath: 'a.png', width: 0, height: 10, text: 'x' }]
      }).success
    ).toBe(false)
    expect(
      recognizeResultSchema.safeParse({ items: [{ status: 'failed', inputPath: 'a.png' }] }).success
    ).toBe(false)
    expect(
      recognizeResultSchema.safeParse({
        items: [
          { status: 'done', inputPath: 'a.pdf', width: 10, height: 10, pageCount: 0, text: 'x' }
        ]
      }).success
    ).toBe(false)
  })
})

describe('exportPayloadSchema', () => {
  it('接受 per-file/merged 合法载荷', () => {
    for (const mode of ['per-file', 'merged']) {
      expect(
        exportPayloadSchema.safeParse({
          outputDir: 'C:\\导出 目录',
          mode,
          items: [{ fileName: '中文 名称.PNG', text: '内容' }]
        }).success
      ).toBe(true)
    }
  })

  it('拒绝缺目录、未知模式、路径分隔符、空文本与超长文本', () => {
    const base = { outputDir: 'C:\\x', mode: 'merged', items: [{ fileName: 'a.png', text: 'x' }] }
    expect(exportPayloadSchema.safeParse({ ...base, outputDir: '' }).success).toBe(false)
    expect(exportPayloadSchema.safeParse({ ...base, mode: 'other' }).success).toBe(false)
    expect(
      exportPayloadSchema.safeParse({ ...base, items: [{ fileName: 'a/b.png', text: 'x' }] })
        .success
    ).toBe(false)
    expect(
      exportPayloadSchema.safeParse({ ...base, items: [{ fileName: 'a.png', text: '' }] }).success
    ).toBe(false)
    expect(exportPayloadSchema.safeParse({ ...base, items: [] }).success).toBe(false)
  })
})
