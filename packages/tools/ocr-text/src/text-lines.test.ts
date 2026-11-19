/**
 * @file text-lines 单测（阅读顺序重排与文本拼接）
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import type { OcrTextLine } from './schema'
import { composeText, sortReadingOrder, verticalOverlapRatio } from './text-lines'

function line(text: string, x: number, y: number, width = 0.2, height = 0.05): OcrTextLine {
  return { text, x, y, width, height }
}

describe('verticalOverlapRatio', () => {
  it('同行重叠为 1，相邻行无重叠为负值', () => {
    expect(verticalOverlapRatio(line('a', 0, 0.1), line('b', 0.5, 0.11))).toBeGreaterThan(0.5)
    expect(verticalOverlapRatio(line('a', 0, 0.1), line('b', 0, 0.2))).toBeLessThan(0)
  })

  it('零高度视为不重叠', () => {
    expect(verticalOverlapRatio(line('a', 0, 0.1, 0.2, 0), line('b', 0, 0.1, 0.2, 0))).toBe(0)
  })
})

describe('sortReadingOrder', () => {
  it('同行按 x、跨行按 y 重排', () => {
    const lines = [
      line('第二行右', 0.5, 0.3),
      line('第一行右', 0.5, 0.1),
      line('第二行左', 0.1, 0.31),
      line('第一行左', 0.1, 0.11)
    ]
    expect(sortReadingOrder(lines).map((item) => item.text)).toEqual([
      '第一行左',
      '第一行右',
      '第二行左',
      '第二行右'
    ])
  })

  it('纵向轻微重叠仍视为同一行', () => {
    const lines = [line('b', 0.5, 0.12), line('a', 0.1, 0.1)]
    expect(sortReadingOrder(lines).map((item) => item.text)).toEqual(['a', 'b'])
  })

  it('中心 y 相同时按 x 兜底', () => {
    const lines = [line('右', 0.5, 0.1), line('左', 0.1, 0.1)]
    expect(sortReadingOrder(lines).map((item) => item.text)).toEqual(['左', '右'])
  })

  it('同行 x 相同时按 y 兜底', () => {
    const lines = [line('下', 0.2, 0.11), line('上', 0.2, 0.1)]
    expect(sortReadingOrder(lines).map((item) => item.text)).toEqual(['上', '下'])
  })

  it('空数组返回空数组且不修改入参', () => {
    expect(sortReadingOrder([])).toEqual([])
    const lines = [line('b', 0.5, 0.3), line('a', 0.1, 0.1)]
    sortReadingOrder(lines)
    expect(lines[0]?.text).toBe('b')
  })
})

describe('composeText', () => {
  it('以换行拼接', () => {
    expect(composeText([line('第一行', 0, 0), line('第二行', 0, 0.1)])).toBe('第一行\n第二行')
    expect(composeText([])).toBe('')
  })
})
