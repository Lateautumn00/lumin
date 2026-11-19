/**
 * @file ranges.test.ts ranges.ts 单测（页码区间解析全分支）
 * @author cuilanchao
 * @date 2026-11-19
 * @description parsePageList / parseRangeGroups / toRangeList / rangeLabel
 */
import { describe, expect, it } from 'vitest'
import { parsePageList, parseRangeGroups, rangeLabel, toRangeList } from './ranges'

describe('parsePageList', () => {
  it('解析混合区间为升序去重页码', () => {
    expect(parsePageList('1-3,5,7-9', 10)).toEqual({ ok: true, value: [1, 2, 3, 5, 7, 8, 9] })
    expect(parsePageList('9, 1 ,2', 10)).toEqual({ ok: true, value: [1, 2, 9] })
    expect(parsePageList('2-2', 10)).toEqual({ ok: true, value: [2] })
  })

  it('allowEmpty：空文本返回 null（表示全部页）', () => {
    expect(parsePageList('  ', 10, { allowEmpty: true })).toEqual({ ok: true, value: null })
  })

  it('空文本未允许时返回 empty 失败', () => {
    expect(parsePageList('', 10)).toEqual({ ok: false, reason: 'empty', token: '' })
    expect(parsePageList(' , ', 10)).toMatchObject({ ok: false, reason: 'empty' })
  })

  it('语法错误 → syntax', () => {
    expect(parsePageList('a', 10)).toEqual({ ok: false, reason: 'syntax', token: 'a' })
    expect(parsePageList('1-', 10)).toMatchObject({ ok: false, reason: 'syntax' })
    expect(parsePageList('0-3', 10)).toMatchObject({ ok: false, reason: 'syntax' })
    expect(parsePageList('3-1', 10)).toMatchObject({ ok: false, reason: 'syntax' })
  })

  it('越界 → overflow', () => {
    expect(parsePageList('11', 10)).toEqual({ ok: false, reason: 'overflow', token: '11' })
    expect(parsePageList('1-99', 10)).toMatchObject({ ok: false, reason: 'overflow' })
  })
})

describe('parseRangeGroups', () => {
  it('每段一组，保持书写顺序', () => {
    expect(parseRangeGroups('1-3,5,7-8', 10)).toEqual({
      ok: true,
      value: [[1, 2, 3], [5], [7, 8]]
    })
  })

  it('区间重叠 → overlap', () => {
    expect(parseRangeGroups('1-3,3-5', 10)).toEqual({
      ok: false,
      reason: 'overlap',
      token: 'overlap'
    })
    expect(parseRangeGroups('1,1', 10)).toMatchObject({ ok: false, reason: 'overlap' })
  })

  it('空文本/越界/语法错误', () => {
    expect(parseRangeGroups('', 10)).toMatchObject({ ok: false, reason: 'empty' })
    expect(parseRangeGroups(' , ', 10)).toMatchObject({ ok: false, reason: 'empty' })
    expect(parseRangeGroups('1-11', 10)).toMatchObject({ ok: false, reason: 'overflow' })
    expect(parseRangeGroups('x', 10)).toMatchObject({ ok: false, reason: 'syntax' })
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
