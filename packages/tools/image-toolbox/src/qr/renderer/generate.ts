/**
 * @file 二维码渲染纯函数（样式映射 / PNG dataURL / SVG 文本）
 * @author cuilanchao
 * @date 2026-11-19
 * @description qrcode 库的薄封装（spec §6.2）：越界样式钳制、dataURL 转 base64；
 *              浏览器构建走 canvas，Node 单测走 pngjs，行为一致
 */
import { toDataURL, toString as qrToString } from 'qrcode'
import { MAX_MARGIN, MAX_SIZE, MIN_MARGIN, MIN_SIZE, type QrStyle } from '../schema'

/** qrcode 库选项（与库签名对齐的子集） */
export interface QrOptions {
  errorCorrectionLevel: QrStyle['errorCorrection']
  width: number
  margin: number
  color: { dark: string; light: string }
}

/**
 * 数值钳制并取整
 * @param value 原始数值
 * @param min 下限
 * @param max 上限
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * 样式 → qrcode 选项（尺寸/边距钳制到 spec 范围）
 * @param style 表单样式
 */
export function createQrOptions(style: QrStyle): QrOptions {
  return {
    errorCorrectionLevel: style.errorCorrection,
    width: clamp(style.size, MIN_SIZE, MAX_SIZE),
    margin: clamp(style.margin, MIN_MARGIN, MAX_MARGIN),
    color: { dark: style.foreground, light: style.background }
  }
}

/**
 * 生成 PNG dataURL（预览与 PNG 保存共用）
 * @param text 二维码内容
 * @param style 表单样式
 */
export function toPngDataUrl(text: string, style: QrStyle): Promise<string> {
  return toDataURL(text, createQrOptions(style))
}

/**
 * 生成 SVG 文本
 * @param text 二维码内容
 * @param style 表单样式
 */
export function toSvg(text: string, style: QrStyle): Promise<string> {
  return qrToString(text, { ...createQrOptions(style), type: 'svg' })
}

/**
 * dataURL → base64（无逗号时原样返回，便于单测与容错）
 * @param dataUrl 形如 `data:image/png;base64,AAAA`
 */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}
