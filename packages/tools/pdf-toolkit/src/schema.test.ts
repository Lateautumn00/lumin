import { describe, expect, it } from 'vitest'
import {
  COMPRESS_LEVELS,
  COMPRESS_PRESETS,
  compressPayloadSchema,
  deletePayloadSchema,
  extractImagesPayloadSchema,
  extractTextPayloadSchema,
  infoPayloadSchema,
  MAX_MERGE_FILES,
  MAX_WATERMARK_IMAGE_CHARS,
  mergePayloadSchema,
  metadataPayloadSchema,
  pageNumberPayloadSchema,
  reorderPayloadSchema,
  rotatePayloadSchema,
  splitPayloadSchema,
  watermarkPayloadSchema
} from './schema'

const PDF = 'C:/文档/示例 卷.pdf'

describe('pdf-toolkit schema（spec §5）', () => {
  it('合法载荷通过并保留字段', () => {
    expect(infoPayloadSchema.parse({ inputPath: PDF })).toEqual({ inputPath: PDF })
    expect(mergePayloadSchema.parse({ inputPaths: [PDF, 'B.PDF'] }).inputPaths).toHaveLength(2)
    expect(splitPayloadSchema.parse({ inputPath: PDF, ranges: '1-3,5' }).ranges).toBe('1-3,5')
    expect(deletePayloadSchema.parse({ inputPath: PDF, ranges: '2' }).ranges).toBe('2')
    expect(rotatePayloadSchema.parse({ inputPath: PDF, ranges: '', degrees: 90 })).toMatchObject({
      degrees: 90
    })
    expect(reorderPayloadSchema.parse({ inputPath: PDF, order: [3, 1, 2] }).order).toEqual([
      3, 1, 2
    ])
    expect(
      metadataPayloadSchema.parse({ inputPath: PDF, metadata: { title: '标题' } }).metadata.title
    ).toBe('标题')
  })

  it('拒绝非 PDF 与空路径', () => {
    expect(infoPayloadSchema.safeParse({ inputPath: 'a.txt' }).success).toBe(false)
    expect(infoPayloadSchema.safeParse({ inputPath: '' }).success).toBe(false)
  })

  it('合并数量边界：至少 2、最多 100', () => {
    expect(mergePayloadSchema.safeParse({ inputPaths: [PDF] }).success).toBe(false)
    const tooMany = Array.from({ length: MAX_MERGE_FILES + 1 }, () => PDF)
    expect(mergePayloadSchema.safeParse({ inputPaths: tooMany }).success).toBe(false)
    const max = Array.from({ length: MAX_MERGE_FILES }, () => PDF)
    expect(mergePayloadSchema.safeParse({ inputPaths: max }).success).toBe(true)
  })

  it('页码范围仅允许数字/逗号/连字符/空白，且不为空', () => {
    expect(splitPayloadSchema.safeParse({ inputPath: PDF, ranges: '' }).success).toBe(false)
    expect(splitPayloadSchema.safeParse({ inputPath: PDF, ranges: '1;2' }).success).toBe(false)
    expect(splitPayloadSchema.safeParse({ inputPath: PDF, ranges: '1 - 3, 5' }).success).toBe(true)
  })

  it('旋转角度仅支持 90/180/270；ranges 可缺省', () => {
    expect(rotatePayloadSchema.safeParse({ inputPath: PDF, degrees: 45 }).success).toBe(false)
    expect(rotatePayloadSchema.safeParse({ inputPath: PDF, degrees: 180 }).success).toBe(true)
  })

  it('重排顺序：非空、正整数', () => {
    expect(reorderPayloadSchema.safeParse({ inputPath: PDF, order: [] }).success).toBe(false)
    expect(reorderPayloadSchema.safeParse({ inputPath: PDF, order: [0] }).success).toBe(false)
    expect(reorderPayloadSchema.safeParse({ inputPath: PDF, order: [1.5] }).success).toBe(false)
  })

  it('元数据：单字段 ≤500 且至少一项非空', () => {
    expect(metadataPayloadSchema.safeParse({ inputPath: PDF, metadata: {} }).success).toBe(false)
    expect(
      metadataPayloadSchema.safeParse({ inputPath: PDF, metadata: { title: '   ' } }).success
    ).toBe(false)
    expect(
      metadataPayloadSchema.safeParse({ inputPath: PDF, metadata: { title: 'x'.repeat(501) } })
        .success
    ).toBe(false)
    expect(
      metadataPayloadSchema.safeParse({ inputPath: PDF, metadata: { author: '作者' } }).success
    ).toBe(true)
  })
})

describe('watermark / page-number schema（M17）', () => {
  const textBase = {
    kind: 'text' as const,
    inputPath: PDF,
    imageData: 'iVBORw0KGgo=',
    opacity: 0.4,
    angle: 45,
    scale: 20,
    tile: false
  }

  const imageBase = {
    kind: 'image' as const,
    inputPath: PDF,
    imagePath: 'C:/a/水印 图.PNG',
    opacity: 0.4,
    angle: 0,
    scale: 30,
    tile: true
  }

  const pageBase = {
    inputPath: PDF,
    format: '{n}/{total}',
    position: 'bottom-center' as const,
    startPage: 1,
    fontSize: 12,
    color: '#333333',
    margin: 24
  }

  it('水印 text/image 合法载荷', () => {
    expect(watermarkPayloadSchema.safeParse(textBase).success).toBe(true)
    expect(watermarkPayloadSchema.safeParse(imageBase).success).toBe(true)
    expect(watermarkPayloadSchema.safeParse({ ...textBase, ranges: '1-3,5' }).success).toBe(true)
  })

  it('水印：text 必填 imageData，image 扩展名白名单', () => {
    expect(watermarkPayloadSchema.safeParse({ ...textBase, imageData: '' }).success).toBe(false)
    expect(
      watermarkPayloadSchema.safeParse({
        kind: 'text',
        inputPath: PDF,
        opacity: 0.4,
        angle: 45,
        scale: 20,
        tile: false
      }).success
    ).toBe(false)
    expect(watermarkPayloadSchema.safeParse({ ...imageBase, imagePath: 'a.gif' }).success).toBe(
      false
    )
    expect(watermarkPayloadSchema.safeParse({ ...imageBase, imagePath: 'a.pdf' }).success).toBe(
      false
    )
  })

  it('水印：图片 base64 上限', () => {
    const tooLong = 'A'.repeat(MAX_WATERMARK_IMAGE_CHARS + 1)
    expect(watermarkPayloadSchema.safeParse({ ...textBase, imageData: tooLong }).success).toBe(
      false
    )
  })

  it('水印：透明度/角度/大小/页码范围边界', () => {
    expect(watermarkPayloadSchema.safeParse({ ...textBase, opacity: 0.04 }).success).toBe(false)
    expect(watermarkPayloadSchema.safeParse({ ...textBase, opacity: 1.01 }).success).toBe(false)
    expect(watermarkPayloadSchema.safeParse({ ...textBase, angle: 91 }).success).toBe(false)
    expect(watermarkPayloadSchema.safeParse({ ...textBase, angle: 45.5 }).success).toBe(false)
    expect(watermarkPayloadSchema.safeParse({ ...textBase, scale: 4 }).success).toBe(false)
    expect(watermarkPayloadSchema.safeParse({ ...textBase, scale: 51 }).success).toBe(false)
    expect(watermarkPayloadSchema.safeParse({ ...textBase, ranges: '1;2' }).success).toBe(false)
  })

  it('页码：合法载荷与 ASCII/{n} 校验', () => {
    expect(pageNumberPayloadSchema.safeParse(pageBase).success).toBe(true)
    expect(pageNumberPayloadSchema.safeParse({ ...pageBase, ranges: '' }).success).toBe(true)
    expect(pageNumberPayloadSchema.safeParse({ ...pageBase, format: '第 {n} 页' }).success).toBe(
      false
    )
    expect(pageNumberPayloadSchema.safeParse({ ...pageBase, format: 'abc' }).success).toBe(false)
    expect(pageNumberPayloadSchema.safeParse({ ...pageBase, format: '' }).success).toBe(false)
    expect(
      pageNumberPayloadSchema.safeParse({ ...pageBase, format: `{n}${'x'.repeat(100)}` }).success
    ).toBe(false)
  })

  it('页码：位置/起始页/字号/颜色/边距边界', () => {
    expect(pageNumberPayloadSchema.safeParse({ ...pageBase, position: 'center' }).success).toBe(
      false
    )
    expect(pageNumberPayloadSchema.safeParse({ ...pageBase, position: 'top-left' }).success).toBe(
      true
    )
    expect(pageNumberPayloadSchema.safeParse({ ...pageBase, startPage: 0 }).success).toBe(false)
    expect(pageNumberPayloadSchema.safeParse({ ...pageBase, startPage: 10_001 }).success).toBe(
      false
    )
    expect(pageNumberPayloadSchema.safeParse({ ...pageBase, fontSize: 7 }).success).toBe(false)
    expect(pageNumberPayloadSchema.safeParse({ ...pageBase, fontSize: 33 }).success).toBe(false)
    expect(pageNumberPayloadSchema.safeParse({ ...pageBase, color: 'red' }).success).toBe(false)
    expect(pageNumberPayloadSchema.safeParse({ ...pageBase, margin: 11 }).success).toBe(false)
    expect(pageNumberPayloadSchema.safeParse({ ...pageBase, margin: 73 }).success).toBe(false)
  })
})

describe('extract / compress schema（M38）', () => {
  it('文本提取：合法载荷且 ranges 可缺省/可空串', () => {
    expect(extractTextPayloadSchema.parse({ inputPath: PDF })).toEqual({ inputPath: PDF })
    expect(extractTextPayloadSchema.parse({ inputPath: PDF, ranges: '1-3,5' }).ranges).toBe('1-3,5')
    expect(extractTextPayloadSchema.parse({ inputPath: PDF, ranges: '' }).ranges).toBe('')
  })

  it('文本提取：拒绝非 PDF 与非法页码语法', () => {
    expect(extractTextPayloadSchema.safeParse({ inputPath: 'a.txt' }).success).toBe(false)
    expect(extractTextPayloadSchema.safeParse({ inputPath: PDF, ranges: '1;2' }).success).toBe(
      false
    )
  })

  it('图片提取：合法载荷且 ranges 可缺省/可空串', () => {
    expect(extractImagesPayloadSchema.safeParse({ inputPath: PDF }).success).toBe(true)
    expect(extractImagesPayloadSchema.safeParse({ inputPath: PDF, ranges: '1-3,5' }).success).toBe(
      true
    )
    expect(extractImagesPayloadSchema.safeParse({ inputPath: PDF, ranges: '' }).success).toBe(true)
  })

  it('图片提取：拒绝非 PDF 与非法页码语法', () => {
    expect(extractImagesPayloadSchema.safeParse({ inputPath: 'a.txt' }).success).toBe(false)
    expect(extractImagesPayloadSchema.safeParse({ inputPath: PDF, ranges: '1;2' }).success).toBe(
      false
    )
  })

  it('压缩：level 三档必填，非法档位与页码语法拒绝', () => {
    expect(compressPayloadSchema.parse({ inputPath: PDF, level: 'medium' }).level).toBe('medium')
    expect(compressPayloadSchema.safeParse({ inputPath: PDF, level: 'ultra' }).success).toBe(false)
    expect(compressPayloadSchema.safeParse({ inputPath: PDF }).success).toBe(false)
    expect(
      compressPayloadSchema.safeParse({ inputPath: PDF, level: 'high', ranges: '1;2' }).success
    ).toBe(false)
  })

  it('档位常量与预设数值单源', () => {
    expect(COMPRESS_LEVELS).toEqual(['low', 'medium', 'high'])
    expect(COMPRESS_PRESETS.low).toEqual({ dpi: 96, quality: 60 })
    expect(COMPRESS_PRESETS.medium).toEqual({ dpi: 150, quality: 75 })
    expect(COMPRESS_PRESETS.high).toEqual({ dpi: 200, quality: 85 })
  })
})
