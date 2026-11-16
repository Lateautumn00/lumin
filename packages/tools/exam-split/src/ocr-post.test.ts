import { describe, expect, it } from 'vitest'
import { ctcDecode, detBoxes, parseDict } from './ocr-post'

/** 构造 width×height 概率图，blobs 内为 prob、其余为 0 */
function probMap(
  width: number,
  height: number,
  blobs: readonly { x0: number; y0: number; x1: number; y1: number; prob: number }[]
): Float32Array {
  const out = new Float32Array(width * height)
  for (const blob of blobs) {
    for (let y = blob.y0; y < blob.y1; y++) {
      for (let x = blob.x0; x < blob.x1; x++) {
        out[y * width + x] = blob.prob
      }
    }
  }
  return out
}

describe('detBoxes', () => {
  it('连通域 → 归一化行框（unclip 外扩，spike 口径）', () => {
    const boxes = detBoxes(
      probMap(20, 20, [{ x0: 2, y0: 4, x1: 7, y1: 8, prob: 0.9 }]),
      20,
      20,
      20,
      20
    )
    expect(boxes).toHaveLength(1)
    const box = boxes[0]
    expect(box).toBeDefined()
    // unclip distance = 5*4*1.5 / (2*(5+4)) = 1.666...
    const distance = (5 * 4 * 1.5) / (2 * (5 + 4))
    expect(box?.x).toBeCloseTo((2 - distance) / 20, 5)
    expect(box?.y).toBeCloseTo((4 - distance) / 20, 5)
    // x1 = 框右缘 7 + distance（maxX+1 口径）
    expect(box?.width).toBeCloseTo((7 + distance - (2 - distance)) / 20, 5)
    expect(box?.score).toBeCloseTo(0.9, 5)
  })

  it('多块互不合并', () => {
    const boxes = detBoxes(
      probMap(20, 20, [
        { x0: 1, y0: 1, x1: 6, y1: 5, prob: 0.9 },
        { x0: 1, y0: 10, x1: 6, y1: 14, prob: 0.8 }
      ]),
      20,
      20,
      20,
      20
    )
    expect(boxes).toHaveLength(2)
    expect(boxes[0]?.y).toBeLessThan(boxes[1]?.y ?? 0)
  })

  it('低于 minSize / boxThresh 的碎块被过滤', () => {
    const tiny = detBoxes(
      probMap(20, 20, [{ x0: 1, y0: 1, x1: 3, y1: 3, prob: 0.9 }]),
      20,
      20,
      20,
      20
    )
    expect(tiny).toHaveLength(0)

    const lowScore = detBoxes(
      probMap(20, 20, [{ x0: 2, y0: 2, x1: 10, y1: 8, prob: 0.4 }]),
      20,
      20,
      20,
      20
    )
    expect(lowScore).toHaveLength(0)
  })

  it('概率图长度不足 / 内容尺寸非法 → 空', () => {
    expect(detBoxes(new Float32Array(4), 20, 20, 20, 20)).toEqual([])
    expect(detBoxes(new Float32Array(400), 20, 20, 0, 20)).toEqual([])
  })

  it('内容尺寸小于概率图时按内容归一化并夹到 0–1', () => {
    const boxes = detBoxes(
      probMap(20, 20, [{ x0: 0, y0: 0, x1: 20, y1: 20, prob: 0.9 }]),
      20,
      20,
      10,
      10
    )
    expect(boxes).toHaveLength(1)
    const box = boxes[0]
    expect(box?.x).toBe(0)
    expect(box?.y).toBe(0)
    expect(box?.width).toBeLessThanOrEqual(1)
    expect(box?.height).toBeLessThanOrEqual(1)
  })
})

describe('parseDict', () => {
  it('一行一字，忽略空行与 CRLF', () => {
    expect(parseDict('a\r\nb\n\nc\n')).toEqual(['a', 'b', 'c'])
  })

  it('空串 → 空数组', () => {
    expect(parseDict('')).toEqual([])
  })
})

describe('ctcDecode', () => {
  const dict = ['一', '二']

  /** 构造 [T×C] logits：默认 -1，按 (t,c) 指定值 */
  function logits(
    timeSteps: number,
    classes: number,
    hits: readonly [number, number][]
  ): Float32Array {
    const out = new Float32Array(timeSteps * classes).fill(-1)
    for (const [t, c] of hits) out[t * classes + c] = 1
    return out
  }

  it('blank=0、合并连续重复、字典索引 = 输出索引 − 1（spike 实证）', () => {
    // 序列：blank, 1, 1(重复), 0, 2, 2(重复) → "一二"
    const data = logits(6, 3, [
      [1, 1],
      [2, 1],
      [4, 2],
      [5, 2]
    ])
    expect(ctcDecode(data, 6, 3, dict)).toBe('一二')
  })

  it('连续不同类不合并；全 blank → 空串', () => {
    const data = logits(4, 3, [
      [0, 1],
      [1, 2],
      [2, 1],
      [3, 2]
    ])
    expect(ctcDecode(data, 4, 3, dict)).toBe('一二一二')
    expect(ctcDecode(logits(3, 3, []), 3, 3, dict)).toBe('')
  })

  it('字典外索引跳过；T/C ≤0 → 空串', () => {
    const data = logits(3, 4, [
      [0, 3],
      [1, 1]
    ])
    expect(ctcDecode(data, 3, 4, dict)).toBe('一')
    expect(ctcDecode(data, 0, 4, dict)).toBe('')
    expect(ctcDecode(data, 3, 0, dict)).toBe('')
  })
})
