/**
 * @file extract.test.ts node-kit PDF 内容抽取单测（M38）
 * @author cuilanchao
 * @date 2026-11-21
 * @description buildPageText 换行/裁空白、toTextItems 过滤、decodeRawImage 三种 ImageKind 与
 *              bitmap/非法输入、extractPdfText 真实 PDF、extractPdfImages 假句柄（去重/跳过/上限）
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  buildPageText,
  decodeRawImage,
  ExtractedImageLimitError,
  extractPdfImages,
  extractPdfText,
  toTextItems,
  type PdfRawImage
} from './extract'
import { openPdf, type PdfDocumentHandle, type PdfPageHandle } from './render'

const GRAY = 1
const RGB = 2
const RGBA = 3

describe('buildPageText', () => {
  it('hasEOL 处换行并裁掉行尾空白', () => {
    const text = buildPageText([
      { str: '第一行  ' },
      { str: '续写', hasEOL: true },
      { str: '第二行', hasEOL: true }
    ])
    expect(text).toBe('第一行  续写\n第二行')
  })

  it('空页与纯空白 → 空串（去页首尾空行）', () => {
    expect(buildPageText([])).toBe('')
    expect(
      buildPageText([
        { str: '   ', hasEOL: true },
        { str: '\n', hasEOL: true }
      ])
    ).toBe('')
  })
})

describe('toTextItems', () => {
  it('仅保留 str 为字符串的项', () => {
    expect(
      toTextItems([{ str: 'A' }, { str: 1 }, null, { type: 'beginMarkedContent' }, { str: '' }])
    ).toEqual([
      { str: 'A', hasEOL: false },
      { str: '', hasEOL: false }
    ])
  })
})

describe('decodeRawImage', () => {
  it('RGBA_32BPP 直用', () => {
    const rgba = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    expect(decodeRawImage({ width: 2, height: 1, kind: RGBA, data: rgba })).toEqual({
      width: 2,
      height: 1,
      rgba: new Uint8ClampedArray(rgba)
    })
  })

  it('RGB_24BPP 补 α=255', () => {
    const decoded = decodeRawImage({
      width: 1,
      height: 1,
      kind: RGB,
      data: new Uint8Array([10, 20, 30])
    })
    expect(decoded === null ? null : Array.from(decoded.rgba)).toEqual([10, 20, 30, 255])
  })

  it('GRAYSCALE_1BPP 按行解包（1=白，0=黑）', () => {
    // 8×1：0b10000001 → 白 黑 黑 黑 黑 黑 黑 白
    const decoded = decodeRawImage({
      width: 8,
      height: 1,
      kind: GRAY,
      data: new Uint8Array([0b10000001])
    })
    expect(decoded === null ? null : Array.from(decoded.rgba)).toEqual([
      255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0,
      0, 0, 255, 255, 255, 255, 255
    ])
  })

  it('bitmap 分支优先且数据不足返回 null', () => {
    const bitmap = { width: 1, height: 1, data: new Uint8ClampedArray([9, 8, 7, 6]) }
    expect(decodeRawImage({ bitmap })?.rgba).toEqual(new Uint8ClampedArray([9, 8, 7, 6]))
    expect(decodeRawImage({ width: 2, height: 2, kind: RGBA, data: new Uint8Array(4) })).toBeNull()
    expect(decodeRawImage({ width: 0, height: 2, kind: RGB, data: new Uint8Array(6) })).toBeNull()
    expect(decodeRawImage({ width: 1, height: 1, kind: 99, data: new Uint8Array(4) })).toBeNull()
    expect(decodeRawImage({})).toBeNull()
  })
})

/** 32×32 纯色 RGBA 原始图 */
function solidRaw(red: number, size = 32): PdfRawImage {
  const data = new Uint8Array(size * size * 4)
  for (let index = 0; index < size * size; index += 1) {
    data[index * 4] = red
    data[index * 4 + 3] = 255
  }
  return { width: size, height: size, kind: RGBA, data }
}

/** 假文档句柄：单页，操作符与对象仓库可注入 */
function fakeDoc(
  page: Partial<PdfPageHandle> & Pick<PdfPageHandle, 'rotate' | 'getViewport' | 'render' | 'cleanup'>
): PdfDocumentHandle {
  return {
    numPages: 1,
    getPage: async () => page as PdfPageHandle,
    cleanup: async () => undefined
  }
}

const viewport = (): { width: number; height: number } => ({ width: 1, height: 1 })

describe('extractPdfText（真实 PDF）', () => {
  it('抽出标准字体文本且 hasText=true', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([200, 100])
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    page.drawText('Lumin 2026', { x: 10, y: 40, size: 14, font, color: rgb(0, 0, 0) })
    const opened = await openPdf(await pdf.save())
    try {
      const result = await extractPdfText(opened.doc, [1])
      expect(result.hasText).toBe(true)
      expect(result.pages[0]?.pageNumber).toBe(1)
      expect(result.pages[0]?.text).toContain('Lumin 2026')
    } finally {
      await opened.doc.cleanup()
    }
  })

  it('空白页 → hasText=false', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage([100, 100])
    const opened = await openPdf(await pdf.save())
    try {
      const result = await extractPdfText(opened.doc, [1])
      expect(result).toEqual({ pages: [{ pageNumber: 1, text: '' }], hasText: false })
    } finally {
      await opened.doc.cleanup()
    }
  })
})

describe('extractPdfImages（假句柄）', () => {
  it('抽取 paintImageXObject 与 inline 图，sha256 去重、小图跳过', async () => {
    const doc = fakeDoc({
      rotate: 0,
      getViewport: viewport,
      render: () => ({ promise: Promise.resolve() }),
      cleanup: () => undefined,
      getOperatorList: async () => ({
        fnArray: [85, 86, 85],
        argsArray: [['img1'], [solidRaw(10)], ['small']]
      }),
      objs: {
        get: (id: string) => {
          if (id === 'img1') return solidRaw(10)
          if (id === 'small') return solidRaw(20, 8)
          throw new Error('missing')
        }
      }
    })
    const result = await extractPdfImages(doc, [1])
    expect(result.images).toHaveLength(1)
    expect(result.images[0]?.width).toBe(32)
    expect(result.images[0]?.png.subarray(0, 4).toString('hex')).toBe('89504e47')
    expect(result.skipped).toBe(1)
  })

  it('超过 maxImages → ExtractedImageLimitError', async () => {
    const doc = fakeDoc({
      rotate: 0,
      getViewport: viewport,
      render: () => ({ promise: Promise.resolve() }),
      cleanup: () => undefined,
      getOperatorList: async () => ({
        fnArray: [86, 86],
        argsArray: [[solidRaw(10)], [solidRaw(20)]]
      })
    })
    await expect(extractPdfImages(doc, [1], { maxImages: 1 })).rejects.toBeInstanceOf(
      ExtractedImageLimitError
    )
  })

  it('无操作符能力/取页失败/操作符抛错 → 跳过不中断', async () => {
    const noOps = fakeDoc({
      rotate: 0,
      getViewport: viewport,
      render: () => ({ promise: Promise.resolve() }),
      cleanup: () => undefined
    })
    await expect(extractPdfImages(noOps, [1])).resolves.toEqual({ images: [], skipped: 0 })

    const badPage = fakeDoc({
      rotate: 0,
      getViewport: viewport,
      render: () => ({ promise: Promise.resolve() }),
      cleanup: () => undefined,
      getOperatorList: async () => {
        throw new Error('boom')
      }
    })
    await expect(extractPdfImages(badPage, [1])).resolves.toEqual({ images: [], skipped: 1 })

    const noPage: PdfDocumentHandle = {
      numPages: 1,
      getPage: async () => {
        throw new Error('missing page')
      },
      cleanup: async () => undefined
    }
    await expect(extractPdfImages(noPage, [1])).resolves.toEqual({ images: [], skipped: 1 })
  })
})
