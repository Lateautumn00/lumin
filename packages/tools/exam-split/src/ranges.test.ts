import { describe, expect, it } from 'vitest'
import { rangeLabel, parsePages, parseSplitRanges, toRangeList } from './ranges'
import { EXAM_SPLIT_ERROR_CODES } from './errors'

function expectRangeInvalid(run: () => unknown): void {
  try {
    run()
    expect.unreachable('应当抛 RANGE_INVALID')
  } catch (err) {
    expect(err).toMatchObject({ code: 'RANGE_INVALID' })
  }
}

describe('parsePages', () => {
  it('解析混合区间为升序去重页码', () => {
    expect(parsePages('1-3,5,7-9', 10)).toEqual([1, 2, 3, 5, 7, 8, 9])
    expect(parsePages('9, 1 ,2', 10)).toEqual([1, 2, 9])
    expect(parsePages('2-2', 10)).toEqual([2])
  })

  it('allowEmpty：空文本返回 null（旋转/裁剪默认全部页）', () => {
    expect(parsePages('  ', 10, { allowEmpty: true })).toBeNull()
  })

  it('空文本未允许时抛 RANGE_INVALID', () => {
    expectRangeInvalid(() => parsePages('', 10))
    expectRangeInvalid(() => parsePages(' , ', 10))
  })

  it('语法错误/越界抛 RANGE_INVALID', () => {
    expectRangeInvalid(() => parsePages('a', 10))
    expectRangeInvalid(() => parsePages('1-', 10))
    expectRangeInvalid(() => parsePages('0-3', 10))
    expectRangeInvalid(() => parsePages('3-1', 10))
    expectRangeInvalid(() => parsePages('11', 10))
    expectRangeInvalid(() => parsePages('1-99', 10))
  })
})

describe('parseSplitRanges', () => {
  it('每段一组，保持书写顺序', () => {
    expect(parseSplitRanges('1-3,5,7-8', 10)).toEqual([[1, 2, 3], [5], [7, 8]])
  })

  it('区间重叠抛 RANGE_INVALID（detail=overlap）', () => {
    try {
      parseSplitRanges('1-3,3-5', 10)
      expect.unreachable('应当抛 RANGE_INVALID')
    } catch (err) {
      expect(err).toMatchObject({ code: 'RANGE_INVALID', detail: 'overlap' })
    }
    expectRangeInvalid(() => parseSplitRanges('1,1', 10))
  })

  it('空文本/越界/语法错误抛 RANGE_INVALID', () => {
    expectRangeInvalid(() => parseSplitRanges('', 10))
    expectRangeInvalid(() => parseSplitRanges('1-11', 10))
    expectRangeInvalid(() => parseSplitRanges('x', 10))
  })
})

describe('toRangeList / rangeLabel', () => {
  it('连续页码合并为区间', () => {
    expect(toRangeList([1, 2, 3, 5, 7, 8])).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
      { start: 7, end: 8 }
    ])
    expect(toRangeList([])).toEqual([])
  })

  it('标签：单页去区间符，跨页带连字符', () => {
    expect(rangeLabel({ start: 5, end: 5 })).toBe('5')
    expect(rangeLabel({ start: 1, end: 3 })).toBe('1-3')
  })
})

describe('EXAM_SPLIT_ERROR_CODES', () => {
  it('与 spec §5 + §10.5 的 15 个错误码一致', () => {
    expect(EXAM_SPLIT_ERROR_CODES).toEqual([
      'PDF_NOT_FOUND',
      'PDF_LOCKED',
      'PDF_ENCRYPTED',
      'PDF_INVALID',
      'RANGE_INVALID',
      'NO_PAGES_LEFT',
      'OP_TIMEOUT',
      'OUTPUT_WRITE_FAILED',
      'OP_FAILED',
      'CANCELLED',
      'INVALID_PAYLOAD',
      'OCR_INPUT_INVALID',
      'MODEL_MISSING',
      'NO_REGIONS',
      'OCR_FAILED'
    ])
  })
})
