import { describe, expect, it } from 'vitest'
import {
  deletePayloadSchema,
  infoPayloadSchema,
  MAX_MERGE_FILES,
  mergePayloadSchema,
  metadataPayloadSchema,
  reorderPayloadSchema,
  rotatePayloadSchema,
  splitPayloadSchema
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
