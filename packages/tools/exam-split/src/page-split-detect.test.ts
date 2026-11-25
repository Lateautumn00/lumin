/**
 * @file 试卷页面切分检测单测：灰度/Otsu/纸边/装订沟/旋转半页矩形 + 真实跨页样卷。
 * @author cuilanchao
 * @date 2026-11-25
 * @description 合成图覆盖居中/偏心沟、无沟回退、深色扫描边框、空白页；真实样卷断言栏缝比例。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import type { RgbaImage } from '@lumin/ocr-kit'
import {
  buildInkProfile,
  detectPageSplit,
  detectPaperRect,
  findGutter,
  halfRects,
  isSpreadPage,
  normalizeRotation,
  otsuThreshold,
  toGray
} from './page-split-detect'

const FIXTURES = fileURLToPath(new URL('../fixtures/ocr', import.meta.url))

/** 创建白底画布并返回 RGBA 图 */
function makeImage(width: number, height: number, draw: (ctx: SKRSContext2D) => void): RgbaImage {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  draw(ctx)
  const imageData = ctx.getImageData(0, 0, width, height)
  return { data: imageData.data, width, height }
}

/** 读取真实样卷为 RGBA 图（白底兜底） */
async function loadFixture(name: string): Promise<RgbaImage> {
  const bytes = await readFile(join(FIXTURES, name))
  const source = await loadImage(bytes)
  const canvas = createCanvas(source.width, source.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, source.width, source.height)
  ctx.drawImage(source, 0, 0)
  const imageData = ctx.getImageData(0, 0, source.width, source.height)
  return { data: imageData.data, width: source.width, height: source.height }
}

/** 在指定横向区间画「文字行」块 */
function drawTextBlock(
  ctx: SKRSContext2D,
  fromX: number,
  toX: number,
  fromY: number,
  toY: number
): void {
  ctx.fillStyle = '#151515'
  for (let y = fromY; y < toY; y += 28) {
    ctx.fillRect(fromX, y, toX - fromX, 8)
  }
}

describe('灰度与 Otsu（自适应亮度）', () => {
  it('黑白像素灰度正确', () => {
    const image = makeImage(4, 4, (ctx) => {
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, 2, 4)
    })
    const gray = toGray(image)
    expect(gray[0]).toBe(0)
    expect(gray[3]).toBe(255)
  })

  it('黑白各半时阈值可区分墨迹与纸张', () => {
    const image = makeImage(20, 20, (ctx) => {
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, 10, 20)
    })
    const threshold = otsuThreshold(toGray(image), 20, 20)
    expect(threshold).toBeLessThan(255)
  })

  it('纯白页无有效分割时返回 127', () => {
    const image = makeImage(16, 16, () => undefined)
    expect(otsuThreshold(toGray(image), 16, 16)).toBe(127)
  })
})

describe('装订沟检测（中央空白带）', () => {
  it('居中沟 → ratio≈0.5 且命中装订沟', () => {
    const image = makeImage(1000, 700, (ctx) => {
      drawTextBlock(ctx, 40, 380, 40, 660)
      drawTextBlock(ctx, 620, 960, 40, 660)
    })
    const result = detectPageSplit(image)
    expect(result.usedGutter).toBe(true)
    expect(result.splitRatio).toBeGreaterThan(0.47)
    expect(result.splitRatio).toBeLessThan(0.53)
  })

  it('偏心沟 → 跟随真实书脊而非死板 0.5', () => {
    const image = makeImage(1000, 700, (ctx) => {
      drawTextBlock(ctx, 40, 340, 40, 660)
      drawTextBlock(ctx, 520, 960, 40, 660)
    })
    const result = detectPageSplit(image)
    expect(result.usedGutter).toBe(true)
    expect(result.splitRatio).toBeGreaterThan(0.39)
    expect(result.splitRatio).toBeLessThan(0.47)
  })

  it('满版无沟 → 回退纸面几何中线 0.5', () => {
    const image = makeImage(1000, 700, (ctx) => {
      ctx.fillStyle = '#151515'
      for (let y = 30; y < 670; y += 20) ctx.fillRect(40, y, 920, 6)
    })
    const result = detectPageSplit(image)
    expect(result.usedGutter).toBe(false)
    expect(result.splitRatio).toBeCloseTo(0.5, 2)
  })

  it('空白页 → 回退中线', () => {
    const image = makeImage(800, 500, () => undefined)
    const result = detectPageSplit(image)
    expect(result.usedGutter).toBe(false)
    expect(result.splitRatio).toBeCloseTo(0.5, 2)
  })
})

describe('纸张物理边界（扫描黑边）', () => {
  it('深色背景 → 裁到纸张亮区', () => {
    const image = makeImage(1200, 900, (ctx) => {
      ctx.fillStyle = '#282828'
      ctx.fillRect(0, 0, 1200, 900)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(100, 50, 1000, 800)
      drawTextBlock(ctx, 140, 480, 90, 810)
      drawTextBlock(ctx, 720, 1060, 90, 810)
    })
    const gray = toGray(image)
    const threshold = otsuThreshold(gray, image.width, image.height)
    const paper = detectPaperRect(gray, image.width, image.height, threshold)
    expect(Math.abs(paper.x - 100)).toBeLessThanOrEqual(4)
    expect(Math.abs(paper.y - 50)).toBeLessThanOrEqual(4)
    expect(Math.abs(paper.width - 1000)).toBeLessThanOrEqual(8)
    expect(Math.abs(paper.height - 800)).toBeLessThanOrEqual(8)
    const result = detectPageSplit(image)
    expect(result.splitRatio).toBeGreaterThan(0.45)
    expect(result.splitRatio).toBeLessThan(0.55)
  })

  it('白底页面不裁边（保持整图）', () => {
    const image = makeImage(900, 600, (ctx) => {
      drawTextBlock(ctx, 40, 420, 40, 560)
      drawTextBlock(ctx, 480, 860, 40, 560)
    })
    const gray = toGray(image)
    const threshold = otsuThreshold(gray, image.width, image.height)
    expect(detectPaperRect(gray, image.width, image.height, threshold)).toEqual({
      x: 0,
      y: 0,
      width: 900,
      height: 600
    })
  })
})

describe('墨迹投影与沟检测纯函数', () => {
  it('findGutter 对合成投影返回沟中心', () => {
    const profile = new Float32Array(1000)
    for (let index = 0; index < 1000; index++) {
      profile[index] = index >= 440 && index <= 560 ? 0 : 0.4
    }
    const result = findGutter(profile)
    expect(result.usedGutter).toBe(true)
    expect(result.ratio).toBeCloseTo(0.5, 1)
  })

  it('buildInkProfile 空白页全 0', () => {
    const image = makeImage(200, 100, () => undefined)
    const gray = toGray(image)
    const threshold = otsuThreshold(gray, image.width, image.height)
    const profile = buildInkProfile(gray, image.width, { x: 0, y: 0, width: 200, height: 100 }, threshold)
    expect(Math.max(...profile)).toBe(0)
  })
})

describe('横向双页与旋转半页矩形', () => {
  it('isSpreadPage：横向通过、竖版拒绝', () => {
    expect(isSpreadPage({ width: 1400, height: 1000 })).toBe(true)
    expect(isSpreadPage({ width: 700, height: 1000 })).toBe(false)
  })

  it('normalizeRotation 归一化任意角度', () => {
    expect(normalizeRotation(0)).toBe(0)
    expect(normalizeRotation(90)).toBe(90)
    expect(normalizeRotation(-90)).toBe(270)
    expect(normalizeRotation(450)).toBe(90)
    expect(normalizeRotation(33)).toBe(0)
  })

  it('A3 横向 1190.55×841.89 → 左右各 595.28×841.89（A4）', () => {
    const rects = halfRects({ x: 0, y: 0, width: 1190.55, height: 841.89 }, 0, 0.5)
    expect(rects.left.width).toBeCloseTo(595.275, 2)
    expect(rects.left.height).toBeCloseTo(841.89, 2)
    expect(rects.right.x).toBeCloseTo(595.275, 2)
    expect(rects.right.width).toBeCloseTo(595.275, 2)
  })

  it('旋转 180°：视觉左半 = 页面右半', () => {
    const rects = halfRects({ x: 0, y: 0, width: 1000, height: 700 }, 180, 0.5)
    expect(rects.left.x).toBeCloseTo(500, 2)
    expect(rects.left.width).toBeCloseTo(500, 2)
    expect(rects.right.x).toBeCloseTo(0, 2)
  })

  it('旋转 90°：沿 y 轴切分，视觉左半 = 页面下半', () => {
    const rects = halfRects({ x: 0, y: 0, width: 1000, height: 700 }, 90, 0.5)
    expect(rects.left).toMatchObject({ x: 0, y: 0, width: 1000 })
    expect(rects.left.height).toBeCloseTo(350, 2)
    expect(rects.right.y).toBeCloseTo(350, 2)
  })

  it('旋转 270°：视觉左半 = 页面上半', () => {
    const rects = halfRects({ x: 0, y: 0, width: 1000, height: 700 }, 270, 0.5)
    expect(rects.left.y).toBeCloseTo(350, 2)
    expect(rects.left.height).toBeCloseTo(350, 2)
    expect(rects.right.y).toBeCloseTo(0, 2)
  })
})

describe('边界与回退分支（防御性路径）', () => {
  it('1×1 极小图 → 直接返回半宽中线（不崩溃）', () => {
    const image: RgbaImage = { data: new Uint8ClampedArray(4), width: 1, height: 1 }
    const result = detectPageSplit(image)
    expect(result.splitRatio).toBe(0.5)
    expect(result.usedGutter).toBe(false)
  })

  it('otsuThreshold 空图 → 127', () => {
    expect(otsuThreshold(new Uint8Array(0), 0, 0)).toBe(127)
  })

  it('detectPaperRect 极小图 → 整图', () => {
    expect(detectPaperRect(new Uint8Array(1), 1, 1, 127)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1
    })
  })

  it('全暗图（无亮区）→ 回退整图', () => {
    expect(detectPaperRect(new Uint8Array(400).fill(0), 20, 20, 127)).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 20
    })
  })

  it('深色底 + 极小亮区（覆盖率达标但面积不足）→ 回退整图', () => {
    const gray = new Uint8Array(40 * 40).fill(50)
    for (let y = 15; y < 25; y++) {
      for (let x = 15; x < 25; x++) gray[y * 40 + x] = 255
    }
    expect(detectPaperRect(gray, 40, 40, 127)).toEqual({ x: 0, y: 0, width: 40, height: 40 })
  })

  it('findGutter：投影过短 / 全白 / 满墨 → 均回退 0.5', () => {
    expect(findGutter(new Float32Array(4))).toEqual({ ratio: 0.5, usedGutter: false })
    expect(findGutter(new Float32Array(100))).toEqual({ ratio: 0.5, usedGutter: false })
    expect(findGutter(new Float32Array(100).fill(0.5))).toEqual({ ratio: 0.5, usedGutter: false })
  })

  it('findGutter：唯一空白带超过最大宽 → narrow 为空仍采用候选', () => {
    const profile = new Float32Array(100).fill(0.4)
    for (let index = 40; index <= 60; index++) profile[index] = 0
    const result = findGutter(profile)
    expect(result.usedGutter).toBe(true)
    expect(result.ratio).toBeGreaterThan(0.45)
    expect(result.ratio).toBeLessThan(0.55)
  })

  it('halfRects 比例越界被夹到 0.05/0.95', () => {
    const low = halfRects({ x: 0, y: 0, width: 1000, height: 700 }, 0, 0)
    expect(low.left.width).toBeCloseTo(50, 5)
    const high = halfRects({ x: 0, y: 0, width: 1000, height: 700 }, 0, 1)
    expect(high.left.width).toBeCloseTo(950, 5)
  })
})

describe('真实跨页样卷（fixtures/ocr）', () => {
  it('图1 跨页展开照：书脊比例落在 0.40–0.60', async () => {
    const image = await loadFixture('微信图片_20261118101301_11_3.jpg')
    const result = detectPageSplit(image)
    expect(result.usedGutter).toBe(true)
    expect(result.splitRatio).toBeGreaterThan(0.4)
    expect(result.splitRatio).toBeLessThan(0.6)
  })

  it('图2 跨页展开照：书脊比例落在 0.40–0.60', async () => {
    const image = await loadFixture('微信图片_20261118101307_12_3.jpg')
    const result = detectPageSplit(image)
    expect(result.usedGutter).toBe(true)
    expect(result.splitRatio).toBeGreaterThan(0.4)
    expect(result.splitRatio).toBeLessThan(0.6)
  })
})
