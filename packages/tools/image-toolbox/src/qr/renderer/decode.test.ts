/**
 * @file decode 单测（QR 矩阵 → RGBA → jsQR 闭环）
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import { create } from 'qrcode'
import { decodeImageFile, decodeRgba } from './decode'

/**
 * 把二维码模块矩阵放大为 RGBA 像素（白底黑块 + 静区）
 * @param text 二维码内容
 * @param scale 每模块像素数
 * @param quiet 静区模块数
 */
function rasterize(
  text: string,
  scale = 8,
  quiet = 4
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const qr = create(text, { errorCorrectionLevel: 'M' })
  const size = qr.modules.size
  const total = (size + quiet * 2) * scale
  const rgba = new Uint8ClampedArray(total * total * 4)
  rgba.fill(255)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.modules.data[y * size + x] !== 1) continue
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const px = (quiet + x) * scale + dx
          const py = (quiet + y) * scale + dy
          const index = (py * total + px) * 4
          rgba[index] = 0
          rgba[index + 1] = 0
          rgba[index + 2] = 0
          rgba[index + 3] = 255
        }
      }
    }
  }
  return { rgba, width: total, height: total }
}

describe('decodeRgba', () => {
  it('还原中文与空格内容', () => {
    const { rgba, width, height } = rasterize('https://example.com/你好 世界')
    expect(decodeRgba(rgba, width, height)?.text).toBe('https://example.com/你好 世界')
  })

  it('还原 WiFi 载荷', () => {
    const { rgba, width, height } = rasterize('WIFI:T:WPA;S:my;P:pass;H:false;;')
    expect(decodeRgba(rgba, width, height)?.text).toContain('WIFI:T:WPA')
  })

  it('空白图片返回 null', () => {
    const total = 64
    const rgba = new Uint8ClampedArray(total * total * 4)
    rgba.fill(255)
    expect(decodeRgba(rgba, total, total)).toBeNull()
  })
})

describe('decodeImageFile', () => {
  it('超过 20MB 在读取前直接拒绝', async () => {
    const file = { size: 21 * 1024 * 1024, name: 'big.png' } as File
    await expect(decodeImageFile(file)).rejects.toMatchObject({ code: 'QR_IMAGE_TOO_LARGE' })
  })

  it('createImageBitmap 失败归 QR_IMAGE_UNREADABLE', async () => {
    const original = globalThis.createImageBitmap
    globalThis.createImageBitmap = (() =>
      Promise.reject(new Error('bad image'))) as unknown as typeof createImageBitmap
    try {
      const file = { size: 10, name: 'broken.png' } as File
      await expect(decodeImageFile(file)).rejects.toMatchObject({ code: 'QR_IMAGE_UNREADABLE' })
    } finally {
      globalThis.createImageBitmap = original
    }
  })
})
