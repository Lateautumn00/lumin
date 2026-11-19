/**
 * @file contract.test.ts contract.ts 纯函数单测
 * @author cuilanchao
 * @date 2026-11-19
 * @description DPI 换算、命名模板、图片格式归一、A4 contain 布局、列表移动、失败项投影
 */
import { describe, expect, it } from 'vitest'
import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  a4Layout,
  dpiToScale,
  imageKind,
  mergedPdfName,
  mmToPt,
  moveItem,
  outputImageName,
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

describe('a4Layout', () => {
  it('横图受可用宽度约束，水平边距即为页边距', () => {
    const layout = a4Layout(200, 100, 10)
    expect(layout).not.toBeNull()
    const value = layout as NonNullable<typeof layout>
    expect(value.pageWidth).toBeCloseTo(A4_WIDTH_PT, 6)
    expect(value.pageHeight).toBeCloseTo(A4_HEIGHT_PT, 6)
    expect(value.width).toBeCloseTo(A4_WIDTH_PT - mmToPt(10) * 2, 6)
    expect(value.height).toBeCloseTo(value.width / 2, 6)
    expect(value.x).toBeCloseTo(mmToPt(10), 6)
    expect(value.y).toBeCloseTo((A4_HEIGHT_PT - value.height) / 2, 6)
  })

  it('竖图受可用高度约束，垂直居中', () => {
    const layout = a4Layout(100, 400, 0)
    const value = layout as NonNullable<typeof layout>
    expect(value.height).toBeCloseTo(A4_HEIGHT_PT, 6)
    expect(value.width).toBeCloseTo(A4_HEIGHT_PT / 4, 6)
    expect(value.y).toBeCloseTo(0, 6)
    expect(value.x).toBeCloseTo((A4_WIDTH_PT - value.width) / 2, 6)
  })

  it('边距过大 / 非法尺寸 → null', () => {
    expect(a4Layout(100, 100, 400)).toBeNull()
    expect(a4Layout(0, 100, 10)).toBeNull()
    expect(a4Layout(100, -1, 10)).toBeNull()
  })
})

describe('mergedPdfName', () => {
  it('首图基名 + _合并.pdf', () => {
    expect(mergedPdfName('E:\\相机\\第一张.png')).toBe('E:\\相机\\第一张_合并.pdf')
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
