/**
 * @file ffmpeg 编码参数映射与缩放尺寸求解（spec §5，纯函数无副作用）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 质量 → 各编码器参数（mjpeg/libwebp/libaom-av1/png）、缩放四模式目标尺寸
 *              与「不放大」边界判定、调整效果与调色滤镜链（M55）、ffmpeg 单张失败原因归类
 */
import type { EffectKind, OutputFormat } from './naming'

/** 调整效果类型（M40，命名与滤镜共用；定义在 naming 避免循环依赖） */
export type { EffectKind } from './naming'

/** 黑白二值默认阈值（spec §2.4） */
export const DEFAULT_BINARY_THRESHOLD = 128

/** 调色参数输入（M55 §4.55；0 = 不生效，值域由 schema 保证，此处仍钳制防越界直调） */
export interface AdjustParams {
  brightness: number
  contrast: number
  saturation: number
  sharpen: number
  blur: number
}

/** 调色全 0 基线（不产生任何滤镜段） */
export const ZERO_ADJUST: AdjustParams = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  sharpen: 0,
  blur: 0
}

/** 钳制为整数（非有限值回退 0） */
function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 浮点格式化（最多 2 位小数、去尾零，避免 0.30000000000000004 类噪声） */
function fmt(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** 调色滤镜分组（M55 §4.55）：color 先于效果、spatial 后于效果 */
export interface AdjustFilters {
  /** 色彩段 `eq`（亮度/对比度/饱和度）；null = 无调色 */
  color: string | null
  /** 空间段 `unsharp`/`gblur`（锐化/模糊） */
  spatial: string[]
}

/**
 * 调色滤镜段求解（M55 §4.55，纯函数；全 0 → 无段，输出与 M40 逐字节一致）
 * - 亮度 `brightness`：-100..100 → eq -1..1（0 跳过）
 * - 对比度 `contrast`：-100..100 → eq 1+c/100（0..2；0 跳过）
 * - 饱和度 `saturation`：-100..100 → eq 1+s/100（0..2；0 跳过）
 * - 锐化 `sharpen`：0..100 → `unsharp=5:5:{v/50}:5:5:0`（amount 0.02–2）
 * - 模糊 `blur`：0..100 → `gblur=sigma={v/5}`（0.2–20）
 * @param adjust 调色参数
 */
export function buildAdjustFilters(adjust: AdjustParams): AdjustFilters {
  const brightness = clampInt(adjust.brightness, -100, 100)
  const contrast = clampInt(adjust.contrast, -100, 100)
  const saturation = clampInt(adjust.saturation, -100, 100)
  const sharpen = clampInt(adjust.sharpen, 0, 100)
  const blur = clampInt(adjust.blur, 0, 100)

  let color: string | null = null
  if (brightness !== 0 || contrast !== 0 || saturation !== 0) {
    const parts: string[] = []
    if (brightness !== 0) parts.push(`brightness=${fmt(brightness / 100)}`)
    if (contrast !== 0) parts.push(`contrast=${fmt(1 + contrast / 100)}`)
    if (saturation !== 0) parts.push(`saturation=${fmt(1 + saturation / 100)}`)
    color = `eq=${parts.join(':')}`
  }

  const spatial: string[] = []
  if (sharpen !== 0) spatial.push(`unsharp=5:5:${fmt(sharpen / 50)}:5:5:0`)
  if (blur !== 0) spatial.push(`gblur=sigma=${fmt(blur / 5)}`)
  return { color, spatial }
}

/**
 * 调整效果 → ffmpeg `-vf` 滤镜（spec §5，M55 §4.55 支持调色链）
 * - 链序：`eq`（色彩）→ 效果（灰度 `hue=s=0` / 反色 `negate` / 二值 `format=gray,lut=…`）→ `unsharp`/`gblur`（空间）
 * - 黑白二值：先转灰再按阈值硬切（阈值钳制 0–255 取整）；调色全 0 或缺省 → 与 M40 输出逐字节一致
 * @param effect 效果类型
 * @param threshold 二值阈值（仅 binary 生效）
 * @param adjust 调色参数（缺省全 0）
 */
export function buildEffectFilter(
  effect: EffectKind,
  threshold: number,
  adjust: AdjustParams = ZERO_ADJUST
): string {
  let base: string
  if (effect === 'grayscale') {
    base = 'hue=s=0'
  } else if (effect === 'invert') {
    base = 'negate'
  } else {
    const value = Number.isFinite(threshold)
      ? Math.min(255, Math.max(0, Math.round(threshold)))
      : DEFAULT_BINARY_THRESHOLD
    base = `format=gray,lut=y='if(gt(val,${value}),255,0)'`
  }
  const { color, spatial } = buildAdjustFilters(adjust)
  return [...(color !== null ? [color] : []), base, ...spatial].join(',')
}

/** 编码输入（animated = gif/webp 动图输入，走动画路径保留全部帧） */
export interface EncodeSpec {
  format: OutputFormat
  quality: number
  animated: boolean
}

/**
 * jpg 质量映射：1–100 → mjpeg `-q:v` qscale 2（最好）–31（最差），spec §5 公式
 * @param quality 用户质量 1–100
 */
export function qualityToQscale(quality: number): number {
  const clamped = Math.min(100, Math.max(1, quality))
  return Math.min(31, Math.max(2, Math.round(2 + ((100 - clamped) * 29) / 99)))
}

/**
 * avif 质量映射：1–100 → libaom-av1 `-crf` 0（最好）–63（最差），spec §5 公式
 * @param quality 用户质量 1–100
 */
export function qualityToCrf(quality: number): number {
  const clamped = Math.min(100, Math.max(1, quality))
  return Math.min(63, Math.max(0, Math.round(63 - (clamped * 63) / 100)))
}

/**
 * 编码参数片段（置于 `-i 输入` 之后、输出路径之前；不含缩放滤镜）：
 * - webp 动画：全部帧 + `-loop 0`（实测 ffmpeg 6.1 可用）
 * - 其余：`-frames:v 1` 取首帧（动图转静态图口径，spec §2.2）
 * @param spec 编码输入（格式/质量/是否动图）
 */
export function buildEncodeArgs(spec: EncodeSpec): string[] {
  const { format, quality, animated } = spec
  if (format === 'webp') {
    const qualityArgs = ['-quality', String(quality)]
    return animated ? ['-loop', '0', ...qualityArgs] : ['-frames:v', '1', ...qualityArgs]
  }
  if (format === 'jpg') {
    return ['-frames:v', '1', '-q:v', String(qualityToQscale(quality))]
  }
  if (format === 'png') {
    return ['-frames:v', '1', '-compression_level', '6']
  }
  // bmp/tiff 无质量参数，仅取首帧重编码（压缩「原格式」直出）
  if (format === 'bmp' || format === 'tiff') {
    return ['-frames:v', '1']
  }
  // avif：libaom-av1，still-picture 单图模式（实测参数，spec §5）
  return [
    '-frames:v',
    '1',
    '-crf',
    String(qualityToCrf(quality)),
    '-cpu-used',
    '6',
    '-still-picture',
    '1'
  ]
}

/** 缩放参数输入（schema resizeOptions 去掉 format/quality/noUpscale 后的形状） */
export type ResizeParams =
  | { mode: 'percent'; percent: number }
  | { mode: 'width'; width: number }
  | { mode: 'height'; height: number }
  | { mode: 'fit'; fitWidth: number; fitHeight: number }

/** 目标尺寸（像素，≥1） */
export interface TargetSize {
  width: number
  height: number
}

/** 原始尺寸（probe 得到） */
export interface OriginalSize {
  width: number
  height: number
}

/**
 * 目标尺寸求解（spec §5：四模式 + 「不放大」边界）
 * - percent：等比按百分比
 * - width/height：等比，另一边取整
 * - fit：等比取小系数（适配框内完全容纳）
 * - noUpscale：任一边超出原图 → 返回 null（跳过缩放直接重编码）
 * @param original 原始宽高
 * @param params 缩放参数
 * @param noUpscale 不放大开关
 * @returns 目标尺寸；null = 跳过缩放
 */
export function resolveTargetSize(
  original: OriginalSize,
  params: ResizeParams,
  noUpscale: boolean
): TargetSize | null {
  const { width: ow, height: oh } = original
  let width: number
  let height: number
  if (params.mode === 'percent') {
    width = Math.max(1, Math.round((ow * params.percent) / 100))
    height = Math.max(1, Math.round((oh * params.percent) / 100))
  } else if (params.mode === 'width') {
    width = Math.max(1, params.width)
    height = Math.max(1, Math.round((oh * params.width) / ow))
  } else if (params.mode === 'height') {
    height = Math.max(1, params.height)
    width = Math.max(1, Math.round((ow * params.height) / oh))
  } else {
    const scale = Math.min(params.fitWidth / ow, params.fitHeight / oh)
    width = Math.max(1, Math.round(ow * scale))
    height = Math.max(1, Math.round(oh * scale))
  }
  if (noUpscale && (width > ow || height > oh)) return null
  return { width, height }
}

/**
 * ffmpeg `-vf` 缩放滤镜参数（无缩放时返回空数组）
 * @param size 目标尺寸
 */
export function buildScaleArgs(size: TargetSize | null): string[] {
  return size === null ? [] : ['-vf', `scale=${size.width}:${size.height}`]
}

/** ffmpeg 单张失败归类（spec §7：磁盘满专项 vs 损坏/加密） */
export type FfmpegFailure = 'IT_OUTPUT_WRITE_FAILED' | 'IT_FILE_CORRUPT'

/**
 * 按 ffmpeg stderr 归类单张失败原因（可带目标输出路径区分「输出打不开」与「输入打不开」）
 * @param stderr ffmpeg 错误输出
 * @param outputPath 本次编码的目标输出路径（用于区分输入/输出侧 open 失败）
 */
export function classifyFfmpegFailure(stderr: string, outputPath?: string): FfmpegFailure {
  // 磁盘满与目录不可写同归输出侧（spec §7：输出目录不可写或磁盘空间不足，可重试）
  if (/no space left on device/i.test(stderr)) return 'IT_OUTPUT_WRITE_FAILED'
  if (/permission denied|access is denied/i.test(stderr)) return 'IT_OUTPUT_WRITE_FAILED'
  if (outputPath !== undefined) {
    // Windows deny-ACL 实测：无 Permission denied 字样，仅「Could not open file : <输出路径>」
    const escaped = outputPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`could not open file[^\\n]*${escaped}`, 'i').test(stderr)) {
      return 'IT_OUTPUT_WRITE_FAILED'
    }
    if (/error muxing a packet|error submitting a packet/i.test(stderr)) {
      return 'IT_OUTPUT_WRITE_FAILED'
    }
  }
  return 'IT_FILE_CORRUPT'
}
