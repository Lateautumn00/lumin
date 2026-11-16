import { describe, expect, it } from 'vitest'
import {
  cropPayloadSchema,
  deletePayloadSchema,
  mergePayloadSchema,
  rotatePayloadSchema,
  splitPayloadSchema
} from './schema'

const PDF = 'C:/试卷/卷.pdf'

describe('splitPayloadSchema', () => {
  it('接受合法拆分入参', () => {
    expect(splitPayloadSchema.safeParse({ inputPath: PDF, ranges: '1-3,5' }).success).toBe(true)
  })

  it('拒绝非 pdf / 空区间 / 非法字符', () => {
    expect(splitPayloadSchema.safeParse({ inputPath: 'a.docx', ranges: '1' }).success).toBe(false)
    expect(splitPayloadSchema.safeParse({ inputPath: PDF, ranges: '' }).success).toBe(false)
    expect(splitPayloadSchema.safeParse({ inputPath: PDF, ranges: '1;a' }).success).toBe(false)
    expect(splitPayloadSchema.safeParse({ inputPath: PDF }).success).toBe(false)
  })
})

describe('mergePayloadSchema', () => {
  it('接受 2–100 个文件', () => {
    expect(mergePayloadSchema.safeParse({ inputPaths: [PDF, 'b.pdf'] }).success).toBe(true)
    const many = Array.from({ length: 100 }, (_, index) => `${index}.pdf`)
    expect(mergePayloadSchema.safeParse({ inputPaths: many }).success).toBe(true)
  })

  it('拒绝 1 个与 101 个、非 pdf 路径', () => {
    expect(mergePayloadSchema.safeParse({ inputPaths: [PDF] }).success).toBe(false)
    const tooMany = Array.from({ length: 101 }, (_, index) => `${index}.pdf`)
    expect(mergePayloadSchema.safeParse({ inputPaths: tooMany }).success).toBe(false)
    expect(mergePayloadSchema.safeParse({ inputPaths: [PDF, 'b.doc'] }).success).toBe(false)
  })
})

describe('deletePayloadSchema', () => {
  it('区间必填', () => {
    expect(deletePayloadSchema.safeParse({ inputPath: PDF, ranges: '1-2' }).success).toBe(true)
    expect(deletePayloadSchema.safeParse({ inputPath: PDF, ranges: '' }).success).toBe(false)
    expect(deletePayloadSchema.safeParse({ inputPath: PDF }).success).toBe(false)
  })
})

describe('rotatePayloadSchema', () => {
  it('角度仅 90/180/270，区间可省略', () => {
    expect(rotatePayloadSchema.safeParse({ inputPath: PDF, degrees: 90 }).success).toBe(true)
    expect(
      rotatePayloadSchema.safeParse({ inputPath: PDF, ranges: '1-3', degrees: 270 }).success
    ).toBe(true)
    expect(rotatePayloadSchema.safeParse({ inputPath: PDF, degrees: 45 }).success).toBe(false)
    expect(rotatePayloadSchema.safeParse({ inputPath: PDF, degrees: 360 }).success).toBe(false)
  })
})

describe('cropPayloadSchema', () => {
  const box = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }

  it('接受页内比例框', () => {
    expect(cropPayloadSchema.safeParse({ inputPath: PDF, box }).success).toBe(true)
    expect(
      cropPayloadSchema.safeParse({ inputPath: PDF, ranges: '2', box: { ...box, x: 0, y: 0 } })
        .success
    ).toBe(true)
  })

  it('拒绝越界（x+width>1 / y+height>1）与非正值', () => {
    expect(cropPayloadSchema.safeParse({ inputPath: PDF, box: { ...box, x: 0.6 } }).success).toBe(
      false
    )
    expect(cropPayloadSchema.safeParse({ inputPath: PDF, box: { ...box, width: 0 } }).success).toBe(
      false
    )
    expect(cropPayloadSchema.safeParse({ inputPath: PDF, box: { ...box, x: -0.1 } }).success).toBe(
      false
    )
  })
})
