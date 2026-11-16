import { describe, expect, it } from 'vitest'
import {
  OCR_INPUT_RE,
  cropPayloadSchema,
  deletePayloadSchema,
  mergePayloadSchema,
  ocrDetectPayloadSchema,
  ocrDetectResultSchema,
  ocrExportPayloadSchema,
  ocrRegionSchema,
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

describe('OCR 输入白名单（spec §10.1）', () => {
  it('接受 .pdf/.png/.jpg/.jpeg/.webp（大小写不敏感）', () => {
    for (const path of ['a.pdf', 'b.png', 'c.jpg', 'd.jpeg', 'e.webp', 'F.PNG', 'G.PDF']) {
      expect(OCR_INPUT_RE.test(path)).toBe(true)
    }
  })

  it('拒绝其它扩展名与无扩展名', () => {
    for (const path of ['a.docx', 'b.gif', 'c', 'd.png.txt']) {
      expect(OCR_INPUT_RE.test(path)).toBe(false)
    }
  })
})

describe('ocrRegionSchema（spec §10.4）', () => {
  const line = { text: '1. 题干', x: 0.1, y: 0.1, width: 0.5, height: 0.02 }

  it('接受缺省 x 边界的全宽题区与列内题区', () => {
    expect(ocrRegionSchema.safeParse({ start: 0, end: 1, lines: [line] }).success).toBe(true)
    expect(
      ocrRegionSchema.safeParse({ start: 0, end: 0.5, xStart: 0, xEnd: 0.5, lines: [] }).success
    ).toBe(true)
  })

  it('拒绝 start≥end、xStart≥xEnd、坐标越界', () => {
    expect(ocrRegionSchema.safeParse({ start: 0.5, end: 0.5, lines: [] }).success).toBe(false)
    expect(
      ocrRegionSchema.safeParse({ start: 0, end: 1, xStart: 0.6, xEnd: 0.5, lines: [] }).success
    ).toBe(false)
    expect(ocrRegionSchema.safeParse({ start: -0.1, end: 1, lines: [] }).success).toBe(false)
    expect(ocrRegionSchema.safeParse({ start: 0, end: 1.2, lines: [] }).success).toBe(false)
  })

  it('拒绝越界行框', () => {
    expect(
      ocrRegionSchema.safeParse({
        start: 0,
        end: 1,
        lines: [{ ...line, x: 0.9, width: 0.5 }]
      }).success
    ).toBe(false)
  })
})

describe('ocrDetectPayloadSchema / ocrDetectResultSchema（spec §10.4）', () => {
  const page = {
    pageNumber: 1,
    width: 1191,
    height: 1684,
    regions: [{ start: 0, end: 1, lines: [] }]
  }

  it('入参接受图片/PDF 路径，拒绝其它', () => {
    expect(ocrDetectPayloadSchema.safeParse({ inputPath: 'C:/卷/一.PNG' }).success).toBe(true)
    expect(ocrDetectPayloadSchema.safeParse({ inputPath: 'C:/卷/一.pdf' }).success).toBe(true)
    expect(ocrDetectPayloadSchema.safeParse({ inputPath: 'C:/卷/一.docx' }).success).toBe(false)
    expect(ocrDetectPayloadSchema.safeParse({}).success).toBe(false)
  })

  it('回包要求 ≥1 页、页码 ≥1、region 合法', () => {
    expect(ocrDetectResultSchema.safeParse({ pages: [page] }).success).toBe(true)
    expect(ocrDetectResultSchema.safeParse({ pages: [] }).success).toBe(false)
    expect(ocrDetectResultSchema.safeParse({ pages: [{ ...page, pageNumber: 0 }] }).success).toBe(
      false
    )
    expect(
      ocrDetectResultSchema.safeParse({
        pages: [{ ...page, regions: [{ start: 0.8, end: 0.2, lines: [] }] }]
      }).success
    ).toBe(false)
  })
})

describe('ocrExportPayloadSchema（spec §10.4）', () => {
  const regionPage = {
    pageNumber: 1,
    width: 1191,
    height: 1684,
    regions: [{ start: 0, end: 1, lines: [] }]
  }
  const base = {
    inputPath: 'C:/卷/一.png',
    startNumber: 1,
    exportPdf: false,
    pages: [regionPage]
  }

  it('接受合法导出入参', () => {
    expect(ocrExportPayloadSchema.safeParse(base).success).toBe(true)
    expect(ocrExportPayloadSchema.safeParse({ ...base, startNumber: 9999 }).success).toBe(true)
  })

  it('拒绝 startNumber <1、空页、全部页无题区', () => {
    expect(ocrExportPayloadSchema.safeParse({ ...base, startNumber: 0 }).success).toBe(false)
    expect(ocrExportPayloadSchema.safeParse({ ...base, pages: [] }).success).toBe(false)
    expect(
      ocrExportPayloadSchema.safeParse({
        ...base,
        pages: [{ ...regionPage, regions: [] }]
      }).success
    ).toBe(false)
    expect(
      ocrExportPayloadSchema.safeParse({
        ...base,
        pages: [
          { ...regionPage, regions: [] },
          { ...regionPage, pageNumber: 2, regions: [] }
        ]
      }).success
    ).toBe(false)
  })
})
