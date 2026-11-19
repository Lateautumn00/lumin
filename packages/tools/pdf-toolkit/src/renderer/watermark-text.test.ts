import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  rasterizeWatermarkText,
  WATERMARK_CANVAS_HEIGHT,
  WATERMARK_PADDING,
  watermarkCanvasSize,
  watermarkFont
} from './watermark-text'

interface FakeCanvas {
  width: number
  height: number
  getContext: ReturnType<typeof vi.fn>
  toDataURL: ReturnType<typeof vi.fn>
}

interface FakeContext {
  font: string
  textBaseline: string
  fillStyle: string
  measureText: ReturnType<typeof vi.fn>
  fillText: ReturnType<typeof vi.fn>
}

function makeCanvas(overrides: { dataUrl?: string; ctx?: FakeContext | null } = {}): {
  canvas: FakeCanvas
  ctx: FakeContext
} {
  const ctx: FakeContext = {
    font: '',
    textBaseline: '',
    fillStyle: '',
    measureText: vi.fn(() => ({ width: 200 })),
    fillText: vi.fn()
  }
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ('ctx' in overrides ? overrides.ctx : ctx)),
    toDataURL: vi.fn(() => overrides.dataUrl ?? 'data:image/png;base64,QUJD')
  }
  return { canvas, ctx }
}

function stubCanvas(canvas: FakeCanvas): void {
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('watermark-text（M17）', () => {
  it('字体与画布尺寸由文字宽度推导', () => {
    expect(watermarkFont(160)).toContain('600 160px')
    expect(watermarkFont(160)).toContain('Microsoft YaHei')
    expect(watermarkCanvasSize(200)).toEqual({
      width: 200 + WATERMARK_PADDING * 2,
      height: Math.ceil(WATERMARK_CANVAS_HEIGHT * 1.4)
    })
    expect(watermarkCanvasSize(200.4).width).toBe(201 + WATERMARK_PADDING * 2)
  })

  it('栅格化返回 base64 并居中绘制', async () => {
    const { canvas, ctx } = makeCanvas()
    stubCanvas(canvas)
    await expect(rasterizeWatermarkText('内部资料', '#808080')).resolves.toBe('QUJD')
    expect(canvas.width).toBe(200 + WATERMARK_PADDING * 2)
    expect(canvas.height).toBe(Math.ceil(WATERMARK_CANVAS_HEIGHT * 1.4))
    expect(ctx.fillStyle).toBe('#808080')
    expect(ctx.textBaseline).toBe('middle')
    expect(ctx.fillText).toHaveBeenCalledWith(
      '内部资料',
      WATERMARK_PADDING,
      Math.ceil(WATERMARK_CANVAS_HEIGHT * 1.4) / 2
    )
  })

  it('空 dataURL → PT_WATERMARK_INVALID', async () => {
    stubCanvas(makeCanvas({ dataUrl: 'data:image/png;base64,' }).canvas)
    await expect(rasterizeWatermarkText('x', '#000000')).rejects.toMatchObject({
      code: 'PT_WATERMARK_INVALID',
      detail: 'empty-data-url'
    })
  })

  it('无 2D 上下文 / toDataURL 抛错 → PT_WATERMARK_INVALID', async () => {
    stubCanvas(makeCanvas({ ctx: null }).canvas)
    await expect(rasterizeWatermarkText('x', '#000000')).rejects.toMatchObject({
      code: 'PT_WATERMARK_INVALID',
      detail: 'canvas-2d-unavailable'
    })

    const { canvas } = makeCanvas()
    canvas.toDataURL.mockImplementation(() => {
      throw new Error('tainted')
    })
    stubCanvas(canvas)
    await expect(rasterizeWatermarkText('x', '#000000')).rejects.toMatchObject({
      code: 'PT_WATERMARK_INVALID',
      detail: 'tainted'
    })
  })
})
