/**
 * @file 页面切分编排单测（spec §11）：图片/PDF 两条链路、竖版拒绝、冲突成对命名、进度阶段。
 * @author cuilanchao
 * @date 2026-11-25
 * @description 用合成 RGBA 位图注入假渲染，覆盖检测→裁剪→编码/半页框→写盘全流程；
 *              PDF 产物用 pdf-lib 回读校验页数与半页尺寸。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadImage } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'
import type { RgbaImage } from '@lumin/ocr-kit'
import type { RenderedPage } from './ocr-render'
import { runHalve, type HalveDeps, type HalveProgress } from './page-split-ops'

const roots: string[] = []

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lumin-exam-halve-'))
  roots.push(dir)
  return dir
}

/** 纯白 RGBA 位图（全不透明） */
function blank(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255
    data[index + 1] = 255
    data[index + 2] = 255
    data[index + 3] = 255
  }
  return { data, width, height }
}

/** 填一条黑色横带（模拟文字行） */
function paintBar(image: RgbaImage, x0: number, x1: number, y0: number, y1: number): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = 0
      image.data[offset + 1] = 0
      image.data[offset + 2] = 0
      image.data[offset + 3] = 255
    }
  }
}

/** 横向双页试卷位图：左右各三条文字带，中间留装订沟 */
function spreadImage(width = 400, height = 280): RgbaImage {
  const image = blank(width, height)
  const gutterStart = Math.round(width * 0.45)
  const gutterEnd = Math.round(width * 0.55)
  for (const y of [40, 110, 180]) {
    paintBar(image, 20, gutterStart - 20, y, y + 30)
    paintBar(image, gutterEnd + 20, width - 20, y, y + 30)
  }
  return image
}

function pageOf(image: RgbaImage, pageNumber = 1): RenderedPage {
  return { pageNumber, width: image.width, height: image.height, image }
}

/** 假渲染（忽略路径与选项，固定返回给定页） */
function depsReturning(pages: RenderedPage[]): HalveDeps {
  return { render: async () => pages }
}

describe('runHalve · 图片链路（spec §11）', () => {
  it('A3 横向双页 PNG → 左右两张同格式图，宽度合计=原宽、高=原高', async () => {
    const dir = tempDir()
    const input = join(dir, '跨页.png')
    const image = spreadImage()
    const updates: HalveProgress[] = []
    const { outputPaths, detections } = await runHalve(
      input,
      depsReturning([pageOf(image)]),
      (update) => updates.push(update)
    )

    expect(outputPaths).toEqual([join(dir, '跨页_左.png'), join(dir, '跨页_右.png')])
    const leftBytes = readFileSync(outputPaths[0]!)
    expect([...leftBytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])

    const leftImage = await loadImage(outputPaths[0]!)
    const rightImage = await loadImage(outputPaths[1]!)
    expect(leftImage.height).toBe(280)
    expect(rightImage.height).toBe(280)
    expect(leftImage.width + rightImage.width).toBe(400)

    expect(detections).toHaveLength(1)
    expect(detections[0]?.usedGutter).toBe(true)
    expect(detections[0]?.splitRatio).toBeGreaterThan(0.4)
    expect(detections[0]?.splitRatio).toBeLessThan(0.6)

    expect(updates[0]?.stage).toBe('load')
    expect(updates.some((update) => update.stage === 'detect')).toBe(true)
    expect(updates.some((update) => update.stage === 'write')).toBe(true)
    expect(updates.at(-1)?.stage).toBe('done')
  })

  it('JPG 输入 → 输出 .jpg（JPEG 魔数），保持原像素分辨率', async () => {
    const dir = tempDir()
    const input = join(dir, '试卷 扫描.jpg')
    const image = spreadImage()
    const { outputPaths } = await runHalve(input, depsReturning([pageOf(image)]), () => undefined)

    expect(outputPaths).toEqual([join(dir, '试卷 扫描_左.jpg'), join(dir, '试卷 扫描_右.jpg')])
    const bytes = readFileSync(outputPaths[0]!)
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
  })

  it('竖版页面 → PAGE_NOT_SPREAD（不写出任何文件）', async () => {
    const dir = tempDir()
    const portrait = blank(200, 400)
    paintBar(portrait, 20, 180, 40, 70)
    await expect(
      runHalve(join(dir, '竖版.png'), depsReturning([pageOf(portrait)]), () => undefined)
    ).rejects.toMatchObject({ code: 'PAGE_NOT_SPREAD' })
    expect(existsSync(join(dir, '竖版_左.png'))).toBe(false)
  })

  it('已有同名左页 → 左右成对加同一 (1) 后缀', async () => {
    const dir = tempDir()
    const input = join(dir, '跨页.png')
    writeFileSync(join(dir, '跨页_左.png'), 'occupied')
    const { outputPaths } = await runHalve(
      input,
      depsReturning([pageOf(spreadImage())]),
      () => undefined
    )
    expect(outputPaths).toEqual([join(dir, '跨页_左(1).png'), join(dir, '跨页_右(1).png')])
  })
})

describe('runHalve · PDF 链路（spec §11）', () => {
  async function makePdf(size: [number, number], pages = 1): Promise<string> {
    const dir = tempDir()
    const doc = await PDFDocument.create()
    for (let index = 0; index < pages; index++) doc.addPage(size)
    const path = join(dir, '卷.pdf')
    writeFileSync(path, await doc.save())
    return path
  }

  it('A3 横向单页 → 输出 2 页 A4 尺寸（略去比例误差）', async () => {
    const input = await makePdf([1191.28, 841.89])
    const image = spreadImage(600, 424)
    const { outputPaths, detections } = await runHalve(
      input,
      depsReturning([pageOf(image)]),
      () => undefined
    )

    expect(outputPaths).toEqual([join(dirname(input), '卷_对半切.pdf')])
    const out = await PDFDocument.load(readFileSync(outputPaths[0]!))
    expect(out.getPageCount()).toBe(2)
    for (const page of out.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.64, 1)
      expect(page.getHeight()).toBeCloseTo(841.89, 1)
    }
    expect(detections).toHaveLength(1)
    expect(detections[0]?.trimmed).toBe(false)
  })

  it('两页输入 → 4 页输出、逐页 detections', async () => {
    const input = await makePdf([1191.28, 841.89], 2)
    const { outputPaths, detections } = await runHalve(
      input,
      depsReturning([pageOf(spreadImage(600, 424))]),
      () => undefined
    )
    const out = await PDFDocument.load(readFileSync(outputPaths[0]!))
    expect(out.getPageCount()).toBe(4)
    expect(detections).toHaveLength(2)
    expect(detections.map((item) => item.pageNumber)).toEqual([1, 2])
  })

  it('竖版 PDF → PAGE_NOT_SPREAD（detail 标注页码）', async () => {
    const input = await makePdf([595.28, 841.89])
    const portrait = blank(424, 600)
    paintBar(portrait, 20, 400, 40, 70)
    await expect(
      runHalve(input, depsReturning([pageOf(portrait)]), () => undefined)
    ).rejects.toMatchObject({ code: 'PAGE_NOT_SPREAD', detail: '第 1 页' })
  })

  it('渲染未返回该页 → OP_FAILED（明细带页码）', async () => {
    const input = await makePdf([1191.28, 841.89])
    await expect(runHalve(input, depsReturning([]), () => undefined)).rejects.toMatchObject({
      code: 'OP_FAILED',
      detail: '第 1 页渲染失败'
    })
  })
})

describe('runHalve · 异常与格式分支', () => {
  it('空渲染结果 → OCR_INPUT_INVALID', async () => {
    await expect(
      runHalve(join(tempDir(), '空.png'), depsReturning([]), () => undefined)
    ).rejects.toMatchObject({ code: 'OCR_INPUT_INVALID' })
  })

  it('渲染抛普通错误 → 归一为 OP_FAILED', async () => {
    const deps: HalveDeps = {
      render: async () => {
        throw new Error('render boom')
      }
    }
    await expect(runHalve(join(tempDir(), '坏.png'), deps, () => undefined)).rejects.toMatchObject({
      code: 'OP_FAILED'
    })
  })

  it('输出目录不存在 → OUTPUT_WRITE_FAILED（写失败不抛原始 errno）', async () => {
    const missing = join(tempDir(), 'no-such-dir', '跨页.png')
    await expect(
      runHalve(missing, depsReturning([pageOf(spreadImage())]), () => undefined)
    ).rejects.toMatchObject({ code: 'OUTPUT_WRITE_FAILED' })
  })

  it('WebP 输入 → 输出 .webp 且 RIFF 头', async () => {
    const dir = tempDir()
    const { outputPaths } = await runHalve(
      join(dir, '卷.webp'),
      depsReturning([pageOf(spreadImage())]),
      () => undefined
    )
    expect(outputPaths[0]?.endsWith('_左.webp')).toBe(true)
    const bytes = readFileSync(outputPaths[0]!)
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF')
  })
})
