import { describe, expect, it } from 'vitest'
import {
  FULL_PAGE_BOX,
  mmToRatio,
  parseRangeText,
  rangesToText,
  ratioToMm,
  type PageSize
} from './preview'

/** A4 竖向（pt） */
const A4: PageSize = { width: 595.28, height: 841.89 }

describe('rangesToText（点选 → 规范化文本，spec §2）', () => {
  it('单页不带连字符，多页带连字符，多段逗号拼接', () => {
    expect(rangesToText([{ start: 5, end: 5 }])).toBe('5')
    expect(rangesToText([{ start: 1, end: 3 }])).toBe('1-3')
    expect(
      rangesToText([
        { start: 1, end: 3 },
        { start: 5, end: 5 },
        { start: 7, end: 9 }
      ])
    ).toBe('1-3,5,7-9')
  })

  it('空区间 → 空串', () => {
    expect(rangesToText([])).toBe('')
  })
})

describe('parseRangeText（文本 → 高亮，spec §2）', () => {
  it('空串 → 空数组（清高亮）', () => {
    expect(parseRangeText('')).toEqual([])
    expect(parseRangeText('   ')).toEqual([])
  })

  it('合法语法解析为区间数组（与 ranges.ts 语义一致：段 trim、空段跳过）', () => {
    expect(parseRangeText('1-3,5,7-9')).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
      { start: 7, end: 9 }
    ])
    expect(parseRangeText(' 1-3 , 5 ')).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 }
    ])
    expect(parseRangeText('1,,2')).toEqual([
      { start: 1, end: 1 },
      { start: 2, end: 2 }
    ])
  })

  it('语法错/逆序/零页码/段内空格/无有效段 → null（保留原文标红）', () => {
    expect(parseRangeText('1-a')).toBeNull()
    expect(parseRangeText('3-1')).toBeNull()
    expect(parseRangeText('0')).toBeNull()
    expect(parseRangeText('1 - 3')).toBeNull()
    expect(parseRangeText('1-')).toBeNull()
    expect(parseRangeText('-3')).toBeNull()
    expect(parseRangeText('1;2')).toBeNull()
    expect(parseRangeText(',')).toBeNull()
    expect(parseRangeText(' , ')).toBeNull()
  })
})

describe('mm ↔ 比例换算（裁剪框，spec §1/§2）', () => {
  it('整页 mm → 整页比例', () => {
    const box = mmToRatio(
      {
        x: 0,
        y: 0,
        width: A4.width * (25.4 / 72),
        height: A4.height * (25.4 / 72)
      },
      A4
    )
    expect(box).not.toBeNull()
    expect(box?.x).toBeCloseTo(0, 5)
    expect(box?.width).toBeCloseTo(1, 5)
    expect(box?.height).toBeCloseTo(1, 5)
  })

  it('比例 → mm → 比例 往返一致', () => {
    const ratio = { x: 0.1, y: 0.2, width: 0.5, height: 0.3 }
    const back = mmToRatio(ratioToMm(ratio, A4), A4)
    expect(back?.x).toBeCloseTo(ratio.x, 5)
    expect(back?.y).toBeCloseTo(ratio.y, 5)
    expect(back?.width).toBeCloseTo(ratio.width, 5)
    expect(back?.height).toBeCloseTo(ratio.height, 5)
  })

  it('越出参照页的输入钳到页边', () => {
    const box = mmToRatio({ x: 100, y: 0, width: 1000, height: 10 }, A4)
    expect(box).not.toBeNull()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeCloseTo(1, 5)
  })

  it('非法输入（零尺寸/越界起点/坏页面）→ null', () => {
    expect(mmToRatio({ x: 0, y: 0, width: 0, height: 10 }, A4)).toBeNull()
    expect(mmToRatio({ x: 0, y: 0, width: 10, height: -1 }, A4)).toBeNull()
    expect(mmToRatio({ x: 9999, y: 0, width: 10, height: 10 }, A4)).toBeNull()
    expect(mmToRatio({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 })).toBeNull()
  })

  it('整页常量形状正确', () => {
    expect(FULL_PAGE_BOX).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})
