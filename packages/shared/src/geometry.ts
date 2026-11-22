/**
 * @file geometry.ts 截屏预览坐标映射（纯函数，renderer 共用）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 把预览层内的点击/拖拽位置换算为截图原始像素坐标；越界返回 null。
 *              color-toolbox（吸管取色）与 misc-toolbox（屏幕标尺）共用。
 */

/** 截图像素尺寸 */
export interface PixelSize {
  readonly width: number
  readonly height: number
}

/** 预览图片在视口中的矩形（getBoundingClientRect 子集） */
export interface DisplayRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** 客户端坐标（clientX/clientY） */
export interface ClientPoint {
  readonly x: number
  readonly y: number
}

/**
 * 客户端坐标 → 截图原始像素坐标
 * @param point 客户端坐标
 * @param rect 预览图片矩形
 * @param size 截图原始像素尺寸
 * @returns 越界/无效矩形返回 null
 */
export function mapPointToPixel(
  point: ClientPoint,
  rect: DisplayRect,
  size: PixelSize
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || size.width <= 0 || size.height <= 0) return null
  const offsetX = point.x - rect.left
  const offsetY = point.y - rect.top
  if (offsetX < 0 || offsetY < 0 || offsetX >= rect.width || offsetY >= rect.height) return null
  const x = Math.min(size.width - 1, Math.floor((offsetX / rect.width) * size.width))
  const y = Math.min(size.height - 1, Math.floor((offsetY / rect.height) * size.height))
  return { x, y }
}
