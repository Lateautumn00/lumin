import { describe, expect, it } from 'vitest'
import {
  DET_LIMIT_SIDE,
  REC_HEIGHT,
  REC_PREFIX_RATIO,
  cropRgbaLeft,
  detInputSize,
  normalizeRgba,
  prepDet,
  prepRecPrefix,
  resizeRgba,
  type RgbaImage
} from './ocr-preproc'

/** 构造纯色 RGBA 位图 */
function solid(width: number, height: number, rgba: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgba[0]
    data[i * 4 + 1] = rgba[1]
    data[i * 4 + 2] = rgba[2]
    data[i * 4 + 3] = rgba[3]
  }
  return { data, width, height }
}

/** 逐像素构造位图（value = (x + y) % 256 写入 R 通道） */
function gradient(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = (x + y) % 256
      data[i + 1] = 128
      data[i + 2] = 64
      data[i + 3] = 255
    }
  }
  return { data, width, height }
}

describe('detInputSize', () => {
  it('A4 渲染 1191×1684 → 长边 960 + 宽 704（32 对齐，spike 实证口径）', () => {
    const size = detInputSize(1191, 1684)
    expect(size.contentHeight).toBe(960)
    expect(size.width).toBe(704)
    expect(size.height).toBe(960)
    expect(size.contentWidth).toBe(679)
  })

  it('小图不放大，仅向上对齐到 32 倍数', () => {
    const size = detInputSize(100, 50)
    expect(size.contentWidth).toBe(100)
    expect(size.contentHeight).toBe(50)
    expect(size.width).toBe(128)
    expect(size.height).toBe(64)
  })

  it('宽图长边在宽度上缩放', () => {
    const size = detInputSize(2000, 500)
    expect(size.contentWidth).toBe(DET_LIMIT_SIDE)
    expect(size.contentHeight).toBe(240)
    expect(size.width).toBe(960)
    expect(size.height).toBe(256)
  })
})

describe('resizeRgba', () => {
  it('同尺寸返回等价像素', () => {
    const src = gradient(4, 3)
    const out = resizeRgba(src, 4, 3)
    expect(out.width).toBe(4)
    expect(out.height).toBe(3)
    expect(Array.from(out.data)).toEqual(Array.from(src.data))
  })

  it('纯色图缩放后仍为纯色', () => {
    const out = resizeRgba(solid(10, 10, [200, 100, 50, 255]), 4, 6)
    expect(out.width).toBe(4)
    expect(out.height).toBe(6)
    for (let i = 0; i < 4 * 6; i++) {
      expect(out.data[i * 4]).toBe(200)
      expect(out.data[i * 4 + 3]).toBe(255)
    }
  })

  it('缩小取平均邻域（双线性），不越界读源', () => {
    const out = resizeRgba(gradient(2, 2), 1, 1)
    expect(out.data[3]).toBe(255)
    expect(out.data[0]).toBeGreaterThanOrEqual(0)
    expect(out.data[0]).toBeLessThanOrEqual(255)
  })
})

describe('normalizeRgba', () => {
  it('255 → +1、0 → -1（mean 0.5 / std 0.5）', () => {
    const white = normalizeRgba(solid(1, 1, [255, 255, 255, 255]), [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
    const black = normalizeRgba(solid(1, 1, [0, 0, 0, 255]), [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
    expect(white[0]).toBeCloseTo(1, 5)
    expect(black[0]).toBeCloseTo(-1, 5)
    expect(white.length).toBe(3)
  })

  it('CHW 平面布局：R 在前 1/3、G 在中、B 在后', () => {
    const out = normalizeRgba(solid(1, 1, [255, 0, 0, 255]), [0, 0, 0], [1, 1, 1])
    expect(out[0]).toBeCloseTo(1, 5)
    expect(out[1]).toBeCloseTo(0, 5)
    expect(out[2]).toBeCloseTo(0, 5)
  })
})

describe('prepDet', () => {
  it('输出 3×960×704（A4 口径），padding 区为 0', () => {
    const tensor = prepDet(solid(1191, 1684, [255, 255, 255, 255]))
    expect(tensor.width).toBe(704)
    expect(tensor.height).toBe(960)
    expect(tensor.data.length).toBe(3 * 704 * 960)
    expect(tensor.contentWidth).toBe(679)
    // 内容区右缘（x=678）有值，padding 起点（x=679）为 0
    const y = 0
    expect(tensor.data[y * 704 + 678]).not.toBe(0)
    expect(tensor.data[y * 704 + 679]).toBe(0)
  })
})

describe('prepRecPrefix', () => {
  it('前缀宽 = 3.5×行高，输出 48 高、宽 ≤320', () => {
    const image = solid(400, 40, [255, 255, 255, 255])
    const tensor = prepRecPrefix(image)
    expect(tensor.prefixWidth).toBe(Math.round(REC_PREFIX_RATIO * 40))
    expect(tensor.height).toBe(REC_HEIGHT)
    expect(tensor.width).toBe(168)
    expect(tensor.data.length).toBe(3 * REC_HEIGHT * 168)
  })

  it('前缀宽不超原图宽；宽高比缩放宽下限 8', () => {
    const wide = prepRecPrefix(solid(50, 40, [255, 255, 255, 255]))
    expect(wide.prefixWidth).toBe(50)
    expect(wide.width).toBe(60)

    const narrow = prepRecPrefix(solid(4, 40, [255, 255, 255, 255]))
    expect(narrow.prefixWidth).toBe(4)
    expect(narrow.width).toBe(8)
  })

  it('超长行也按 3.5×行高前缀（宽 168，远低于 320 上限）', () => {
    const long = prepRecPrefix(solid(4000, 40, [255, 255, 255, 255]))
    expect(long.prefixWidth).toBe(140)
    expect(long.width).toBe(168)
  })
})

describe('cropRgbaLeft', () => {
  it('按行跨距裁剪，不串行（回归：连续 subarray 会错位）', () => {
    const src = gradient(4, 2)
    const out = cropRgbaLeft(src, 2)
    expect(out.width).toBe(2)
    expect(out.height).toBe(2)
    // (0,0)=0, (1,0)=1, (0,1)=1, (1,1)=2
    expect(out.data[0]).toBe(0)
    expect(out.data[4]).toBe(1)
    expect(out.data[8]).toBe(1)
    expect(out.data[12]).toBe(2)
  })

  it('宽度 ≥ 源宽时原样返回', () => {
    const src = gradient(3, 3)
    expect(cropRgbaLeft(src, 3)).toBe(src)
    expect(cropRgbaLeft(src, 99)).toBe(src)
  })
})
