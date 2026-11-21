/**
 * @file contract.test.ts contract.ts 纯函数单测
 * @author cuilanchao
 * @date 2026-11-19
 * @description DPI 换算、命名模板、图片格式归一、纸型布局与方向、列表移动、失败项投影
 */
import { describe, expect, it } from 'vitest'
import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  LETTER_HEIGHT_PT,
  LETTER_WIDTH_PT,
  dpiToScale,
  imageKind,
  mergedPdfName,
  mmToPt,
  moveItem,
  outputImageName,
  pageLayout,
  pdfOutputName,
  resolveOrientation,
  toFailure
} from './contract'

describe('dpiToScale / mmToPt', () => {
  it('DPI 以 72 为基准换算', () => {
    expect(dpiToScale(72)).toBe(1)
    expect(dpiToScale(150)).toBeCloseTo(2.0833, 4)
    expect(dpiToScale(300)).toBeCloseTo(4.1667, 4)
  })

  it('25.4mm = 72pt', () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 10)
    expect(mmToPt(0)).toBe(0)
  })
})

describe('outputImageName', () => {
  it('基名 + 页码 + 扩展名（jpeg 落盘 .jpg）', () => {
    expect(outputImageName('E:\\作业 卷\\期中 试卷.pdf', 3, 'jpeg')).toBe(
      'E:\\作业 卷\\期中 试卷_p3.jpg'
    )
    expect(outputImageName('/tmp/a.pdf', 1, 'png')).toBe('/tmp/a_p1.png')
  })
})

describe('imageKind', () => {
  it('png/jpg 直嵌，其余走转码', () => {
    expect(imageKind('a.PNG')).toBe('png')
    expect(imageKind('a.jpg')).toBe('jpeg')
    expect(imageKind('a.JPEG')).toBe('jpeg')
    expect(imageKind('a.webp')).toBe('other')
    expect(imageKind('noext')).toBe('other')
  })
})

describe('pageLayout', () => {
  it('auto：页面等于图片尺寸，忽略方向与边距', () => {
    expect(
      pageLayout(200, 100, { pageSize: 'auto', orientation: 'landscape', marginMm: 20 })
    ).toEqual({ pageWidth: 200, pageHeight: 100, x: 0, y: 0, width: 200, height: 100 })
  })

  it('A4：auto 方向跟随横图 → 横版，受可用宽度约束', () => {
    const layout = pageLayout(200, 100, { pageSize: 'a4', orientation: 'auto', marginMm: 10 })
    const value = layout as NonNullable<typeof layout>
    expect(value.pageWidth).toBeCloseTo(A4_HEIGHT_PT, 6)
    expect(value.pageHeight).toBeCloseTo(A4_WIDTH_PT, 6)
    expect(value.width).toBeCloseTo(A4_HEIGHT_PT - mmToPt(10) * 2, 6)
    expect(value.height).toBeCloseTo(value.width / 2, 6)
    expect(value.x).toBeCloseTo(mmToPt(10), 6)
    expect(value.y).toBeCloseTo((A4_WIDTH_PT - value.height) / 2, 6)
  })

  it('A4：竖图显式竖版，受可用高度约束并水平居中', () => {
    const layout = pageLayout(100, 400, { pageSize: 'a4', orientation: 'portrait', marginMm: 0 })
    const value = layout as NonNullable<typeof layout>
    expect(value.pageWidth).toBeCloseTo(A4_WIDTH_PT, 6)
    expect(value.pageHeight).toBeCloseTo(A4_HEIGHT_PT, 6)
    expect(value.height).toBeCloseTo(A4_HEIGHT_PT, 6)
    expect(value.width).toBeCloseTo(A4_HEIGHT_PT / 4, 6)
    expect(value.y).toBeCloseTo(0, 6)
    expect(value.x).toBeCloseTo((A4_WIDTH_PT - value.width) / 2, 6)
  })

  it('Letter：强制横版 792×612，强制竖版 612×792', () => {
    const landscape = pageLayout(100, 400, {
      pageSize: 'letter',
      orientation: 'landscape',
      marginMm: 0
    }) as NonNullable<ReturnType<typeof pageLayout>>
    expect(landscape.pageWidth).toBe(LETTER_HEIGHT_PT)
    expect(landscape.pageHeight).toBe(LETTER_WIDTH_PT)
    expect(landscape.width).toBeLessThanOrEqual(LETTER_HEIGHT_PT)
    expect(landscape.height).toBeLessThanOrEqual(LETTER_WIDTH_PT)

    const portrait = pageLayout(400, 100, {
      pageSize: 'letter',
      orientation: 'portrait',
      marginMm: 0
    }) as NonNullable<ReturnType<typeof pageLayout>>
    expect(portrait.pageWidth).toBe(LETTER_WIDTH_PT)
    expect(portrait.pageHeight).toBe(LETTER_HEIGHT_PT)
  })

  it('边距过大 / 非法尺寸 → null', () => {
    expect(pageLayout(100, 100, { pageSize: 'a4', orientation: 'auto', marginMm: 400 })).toBeNull()
    expect(
      pageLayout(100, 100, { pageSize: 'letter', orientation: 'portrait', marginMm: 120 })
    ).toBeNull()
    expect(pageLayout(0, 100, { pageSize: 'auto', orientation: 'auto', marginMm: 10 })).toBeNull()
    expect(pageLayout(100, -1, { pageSize: 'auto', orientation: 'auto', marginMm: 10 })).toBeNull()
  })
})

describe('resolveOrientation', () => {
  it('auto 跟随图片（正方形按竖版），显式值原样返回', () => {
    expect(resolveOrientation('auto', 100, 100)).toBe('portrait')
    expect(resolveOrientation('auto', 100, 400)).toBe('portrait')
    expect(resolveOrientation('auto', 200, 100)).toBe('landscape')
    expect(resolveOrientation('landscape', 100, 400)).toBe('landscape')
    expect(resolveOrientation('portrait', 400, 100)).toBe('portrait')
  })
})

describe('mergedPdfName', () => {
  it('首图基名 + _合并.pdf', () => {
    expect(mergedPdfName('E:\\相机\\第一张.png')).toBe('E:\\相机\\第一张_合并.pdf')
  })
})

describe('pdfOutputName', () => {
  it('留空 / 纯空白回退首图基名模板', () => {
    expect(pdfOutputName('E:\\相机\\第一张.png')).toBe('E:\\相机\\第一张_合并.pdf')
    expect(pdfOutputName('E:\\相机\\第一张.png', '')).toBe('E:\\相机\\第一张_合并.pdf')
    expect(pdfOutputName('a.png', '   ')).toBe('a_合并.pdf')
  })

  it('自定义名去尾部 .pdf 后统一补 .pdf（大小写不敏感）', () => {
    expect(pdfOutputName('a.png', '自定义 名称')).toBe('自定义 名称.pdf')
    expect(pdfOutputName('a.png', ' 报告.PDF ')).toBe('报告.pdf')
  })
})

describe('moveItem', () => {
  it('上移/下移返回新数组（原数组不变）', () => {
    const source = ['a', 'b', 'c']
    expect(moveItem(source, 2, 1)).toEqual(['a', 'c', 'b'])
    expect(moveItem(source, 0, 2)).toEqual(['b', 'c', 'a'])
    expect(source).toEqual(['a', 'b', 'c'])
  })

  it('越界/同下标 → 原样副本', () => {
    const source = ['a', 'b']
    expect(moveItem(source, 0, 0)).toEqual(['a', 'b'])
    expect(moveItem(source, -1, 1)).toEqual(['a', 'b'])
    expect(moveItem(source, 0, 5)).toEqual(['a', 'b'])
  })
})

describe('toFailure', () => {
  it('有 detail 时带上，空串/detail 缺省时省略', () => {
    expect(toFailure('a.pdf', { code: 'PI_PDF_CORRUPT', message: '坏了', detail: 'x' })).toEqual({
      file: 'a.pdf',
      code: 'PI_PDF_CORRUPT',
      message: '坏了',
      detail: 'x'
    })
    expect(toFailure('a.pdf', { code: 'PI_PDF_CORRUPT', message: '坏了' })).toEqual({
      file: 'a.pdf',
      code: 'PI_PDF_CORRUPT',
      message: '坏了'
    })
    expect(toFailure('a.pdf', { code: 'X', message: 'm', detail: '' })).not.toHaveProperty('detail')
  })
})
