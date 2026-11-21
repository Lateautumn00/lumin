/**
 * @file GIF 生成纯函数（spec §2.5/§5，M40）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 帧时长 → 帧率、画布规划与超限判定、`filter_complex` 拼装、循环参数、
 *              输出命名；全部无副作用，供 node 任务与单测共用
 */

/** GIF 画布单边上限（px） */
export const GIF_MAX_EDGE = 4096

/** GIF 画布总像素上限（= 4096×4096） */
export const GIF_MAX_PIXELS = 16_777_216

/** 单次最多帧数 */
export const MAX_GIF_FRAMES = 100

/** 帧时长下限（毫秒） */
export const GIF_MIN_FRAME_MS = 50

/** 帧时长上限（毫秒） */
export const GIF_MAX_FRAME_MS = 5000

/** 帧尺寸（绘图失败/非法时上游已拦截） */
export interface GifFrameSize {
  width: number
  height: number
}

/** GIF 画布尺寸 */
export interface GifCanvas {
  width: number
  height: number
}

/**
 * 帧时长换算帧率（`fps = 1000 / 帧时长`，保留 3 位小数）
 * @param durationMs 帧时长（毫秒）
 */
export function fpsFromFrameMs(durationMs: number): number {
  const clamped = Math.min(GIF_MAX_FRAME_MS, Math.max(GIF_MIN_FRAME_MS, Math.round(durationMs)))
  return Math.round((1000 / clamped) * 1000) / 1000
}

/**
 * 规划 GIF 画布（spec §2.5）
 * - 宽：0 = 按首张图片宽，否则用户指定
 * - 高：全部图片按目标宽等比缩放后的最大高（各帧 pad 居中）
 * @param sizes 全部帧原始尺寸（顺序即帧顺序）
 * @param width 目标宽（0 = 首张宽）
 * @returns 画布尺寸；空列表/非法宽/超 4096px 或 1600 万像素 → null
 */
export function planGifCanvas(sizes: readonly GifFrameSize[], width: number): GifCanvas | null {
  const first = sizes[0]
  if (first === undefined) return null
  const targetWidth = width === 0 ? first.width : Math.round(width)
  if (!Number.isFinite(targetWidth) || targetWidth <= 0) return null
  if (targetWidth > GIF_MAX_EDGE) return null
  let height = 0
  for (const size of sizes) {
    if (size.width <= 0 || size.height <= 0) return null
    height = Math.max(height, Math.max(1, Math.round((size.height * targetWidth) / size.width)))
  }
  if (height > GIF_MAX_EDGE) return null
  if (targetWidth * height > GIF_MAX_PIXELS) return null
  return { width: targetWidth, height }
}

/**
 * 逐帧 scale/pad → concat → split → palettegen → paletteuse 滤镜图
 * @param count 帧数（≥1）
 * @param canvas 画布尺寸
 */
export function buildGifFilterGraph(count: number, canvas: GifCanvas): string {
  const { width, height } = canvas
  const branches = Array.from({ length: count }, (_, index) => {
    const scale = `scale=${width}:${height}:force_original_aspect_ratio=decrease`
    const pad = `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=white`
    return `[${index}:v]${scale},${pad},setsar=1[v${index}]`
  })
  const concatInputs = Array.from({ length: count }, (_, index) => `[v${index}]`).join('')
  return [
    branches.join(';'),
    `${concatInputs}concat=n=${count}:v=1:a=0[cat]`,
    '[cat]split[palsrc][framesrc]',
    '[palsrc]palettegen[palette]',
    '[framesrc][palette]paletteuse'
  ].join(';')
}

/**
 * 循环参数（gif muxer `-loop`）：-1 不循环 / 0 无限 / N 次
 * @param loop 循环次数
 */
export function gifLoopArg(loop: number): string {
  const rounded = Math.round(loop)
  if (rounded < 0) return '-1'
  return String(Math.min(10, rounded))
}

/** 本地时间戳 `yyyyMMdd-HHmmss`（与 image-stitch 同模板，工具间不互相 import） */
function timestampName(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/**
 * GIF 输出文件名：`动图_{yyyyMMdd-HHmmss}.gif`
 * @param date 时间
 */
export function gifOutputName(date: Date): string {
  return `动图_${timestampName(date)}.gif`
}
