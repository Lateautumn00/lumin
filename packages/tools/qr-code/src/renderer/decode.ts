/**
 * @file 二维码识别（canvas 像素 → jsQR 解码）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 识别完全在 renderer 完成（spec §6.3）：File → ImageBitmap → canvas →
 *              ImageData → jsQR；体积/解码错误归一为结构化错误码
 */
import jsQR from 'jsqr'
import { MAX_IMAGE_BYTES } from '../schema'
import { toolError } from '../errors'

/** 解码成功结果（纯像素层） */
export interface DecodedQr {
  text: string
}

/** 识别成功结果（含图片元信息） */
export interface DecodedImage {
  text: string
  width: number
  height: number
}

/**
 * 对 RGBA 像素解码二维码（纯函数，单测直接注入矩阵）
 * @param rgba 像素数据（canvas ImageData.data）
 * @param width 像素宽
 * @param height 像素高
 * @returns 解码文本；无码返回 null
 */
export function decodeRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): DecodedQr | null {
  const result = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' })
  if (result === null) return null
  return { text: result.data }
}

/**
 * 识别图片文件中的二维码
 * @param file DropZone 解析出的 File
 */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  if (file.size > MAX_IMAGE_BYTES) throw toolError('QR_IMAGE_TOO_LARGE')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw toolError('QR_IMAGE_UNREADABLE', file.name)
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) throw toolError('QR_IMAGE_UNREADABLE', '无法创建画布')
    context.drawImage(bitmap, 0, 0)
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height)
    const decoded = decodeRgba(imageData.data, bitmap.width, bitmap.height)
    if (decoded === null) throw toolError('QR_DECODE_FAILED')
    return { text: decoded.text, width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}
