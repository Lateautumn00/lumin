/**
 * @file watermark-text.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description 文字水印栅格化：Canvas 绘制（支持中文）→ 透明 PNG base64，
 *              供主进程 pdf-lib 作为图片水印嵌入（M17）。
 */
import { toolError } from '../errors'

/** 画布文字高度（px），宽度按实测文字宽度展开 */
export const WATERMARK_CANVAS_HEIGHT = 160

/** 文字左右内边距（px），避免贴边裁切 */
export const WATERMARK_PADDING = 24

/** 画布字体族（Windows 优先微软雅黑，覆盖中文） */
export const WATERMARK_FONT_FAMILY = '"Microsoft YaHei", "PingFang SC", sans-serif'

/** 画布字体声明 */
export function watermarkFont(size: number): string {
  return `600 ${size}px ${WATERMARK_FONT_FAMILY}`
}

/** 按实测文字宽度计算画布尺寸 */
export function watermarkCanvasSize(textWidth: number): { width: number; height: number } {
  return {
    width: Math.ceil(textWidth) + WATERMARK_PADDING * 2,
    height: Math.ceil(WATERMARK_CANVAS_HEIGHT * 1.4)
  }
}

/**
 * 文字水印 → 透明 PNG base64（不含 data: 前缀）
 * @param text 水印文字（含中文）
 * @param color 文字颜色（#rrggbb）
 */
export async function rasterizeWatermarkText(text: string, color: string): Promise<string> {
  try {
    const canvas = document.createElement('canvas')
    const measure = canvas.getContext('2d')
    if (measure === null) throw new Error('canvas-2d-unavailable')
    measure.font = watermarkFont(WATERMARK_CANVAS_HEIGHT)
    const { width, height } = watermarkCanvasSize(measure.measureText(text).width)
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('canvas-2d-unavailable')
    ctx.font = watermarkFont(WATERMARK_CANVAS_HEIGHT)
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    ctx.fillText(text, WATERMARK_PADDING, height / 2)
    const data = canvas.toDataURL('image/png').split(',')[1] ?? ''
    if (data === '') throw new Error('empty-data-url')
    return data
  } catch (err) {
    throw toolError('PT_WATERMARK_INVALID', err instanceof Error ? err.message : 'rasterize-failed')
  }
}
