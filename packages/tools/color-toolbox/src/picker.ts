/**
 * @file picker.ts 截图取色的坐标映射（复用 shared 公共实现）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 公共逻辑已上提至 @lumin/shared/geometry（屏幕标尺同样复用），此处仅保留原入口。
 */
export { mapPointToPixel } from '@lumin/shared'
export type { ClientPoint, DisplayRect, PixelSize } from '@lumin/shared'
