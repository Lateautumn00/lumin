/**
 * @file ffmpeg 编码参数映射与缩放尺寸求解（spec §5，纯函数无副作用）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 质量 → 各编码器参数（mjpeg/libwebp/libaom-av1/png）、缩放四模式目标尺寸
 *              与「不放大」边界判定、ffmpeg 单张失败原因归类
 */
import type { OutputFormat } from './naming'

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
