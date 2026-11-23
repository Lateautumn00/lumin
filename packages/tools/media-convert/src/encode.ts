/**
 * @file ffmpeg 参数构造纯函数（spec §5，无副作用）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 四模式参数映射 + 失败分类；统一前置 `-y -v error -progress pipe:1 -nostats`
 */
import { CORRUPT_HINTS } from './media'
import { needsFaststart, type AudioFormat, type VideoContainer } from './compat'
import type {
  AudioConvertOptions,
  CompressOptions,
  ExtractAudioOptions,
  QualityLevel,
  Resolution,
  TranscodeOptions,
  TrimOptions
} from './schema'
import type { MediaConvertErrorCode } from './errors'

/** 统一前置（每模式共用） */
export const COMMON_PREFIX = ['-y', '-v', 'error', '-progress', 'pipe:1', '-nostats'] as const

/** 容器 → 视频目标扩展名（与格式一致） */
export type VideoFormat = VideoContainer

/** H.264 / H.265 质量档 → CRF */
const VIDEO_CRF: Record<QualityLevel, number> = {
  high: 18,
  medium: 23,
  low: 28
}

/** VP9 质量档 → CRF */
const VP9_CRF: Record<QualityLevel, number> = {
  high: 28,
  medium: 32,
  low: 36
}

/** 压缩质量档 → CRF + preset + 音频码率 */
const COMPRESS_QUALITY: Record<QualityLevel, { crf: number; preset: string; audio: string }> = {
  high: { crf: 20, preset: 'medium', audio: '192k' },
  medium: { crf: 26, preset: 'veryfast', audio: '128k' },
  low: { crf: 32, preset: 'veryfast', audio: '96k' }
}

/** 目标音频格式 → 编码器 */
const AUDIO_CODEC: Record<AudioFormat, string> = {
  mp3: 'libmp3lame',
  m4a: 'aac',
  wav: 'pcm_s16le',
  flac: 'flac',
  ogg: 'libvorbis',
  aac: 'aac',
  opus: 'libopus'
}

/**
 * 秒 → ffmpeg 时间参数（去掉无意义尾零）
 * @param seconds 秒
 */
function secondsArg(seconds: number): string {
  return String(Number(seconds.toFixed(3)))
}

/**
 * 分辨率 → `-vf scale`（原始返回空；高度上限只缩不放）
 * @param resolution 分辨率参数
 */
function resolutionArgs(resolution: Resolution): string[] {
  if (resolution.kind === 'original') return []
  if (resolution.kind === 'custom') {
    return ['-vf', `scale=${String(resolution.width ?? 0)}:${String(resolution.height ?? 0)}`]
  }
  const height = resolution.height ?? 0
  const width = Math.round((height * 16) / 9)
  return [
    '-vf',
    `scale=w='min(iw,${String(width)})':h='min(ih,${String(height)})':force_original_aspect_ratio=decrease:force_divisible_by=2`
  ]
}

/**
 * 视频编码参数（webm 固定 VP9；其余按编码器 + CRF，码率 >0 时覆盖 CRF）
 * @param options 格式转换参数
 */
function videoEncodeArgs(options: TranscodeOptions): string[] {
  if (options.format === 'webm') {
    const rate =
      options.videoBitrateKbps > 0
        ? ['-b:v', `${String(options.videoBitrateKbps)}k`]
        : ['-crf', String(VP9_CRF[options.quality]), '-b:v', '0']
    return ['-c:v', 'libvpx-vp9', ...rate]
  }
  const encoder = options.codec === 'h265' ? 'libx265' : 'libx264'
  const rate =
    options.videoBitrateKbps > 0
      ? ['-b:v', `${String(options.videoBitrateKbps)}k`]
      : ['-crf', String(VIDEO_CRF[options.quality])]
  return ['-c:v', encoder, '-preset', 'medium', ...rate]
}

/**
 * 容器 → 音频编码（webm = Opus；avi = MP3；其余 AAC）
 * @param container 目标容器
 */
function containerAudioCodec(container: VideoContainer): string {
  if (container === 'webm') return 'libopus'
  if (container === 'avi') return 'libmp3lame'
  return 'aac'
}

/**
 * 视频容器尾部参数（mp4/m4v/mov 加 faststart）
 * @param container 目标容器
 */
function faststartArgs(container: VideoContainer): string[] {
  return needsFaststart(container) ? ['-movflags', '+faststart'] : []
}

/**
 * 格式转换参数（重编码或 remux）
 * @param options 格式转换参数
 * @param input 输入路径
 * @param output 输出路径
 */
export function buildTranscodeArgs(
  options: TranscodeOptions,
  input: string,
  output: string
): string[] {
  if (options.mode === 'remux') return buildRemuxArgs(options.format, input, output)
  const audio = options.removeAudio
    ? ['-an']
    : ['-c:a', containerAudioCodec(options.format), '-b:a', `${String(options.audioBitrateKbps)}k`]
  const fps = options.fps > 0 ? ['-r', String(options.fps)] : []
  return [
    ...COMMON_PREFIX,
    '-i',
    input,
    ...videoEncodeArgs(options),
    ...resolutionArgs(options.resolution),
    ...fps,
    ...audio,
    ...faststartArgs(options.format),
    output
  ]
}

/**
 * 换封装参数（`-c copy`，不重编码）
 * @param container 目标容器
 * @param input 输入路径
 * @param output 输出路径
 */
export function buildRemuxArgs(container: VideoContainer, input: string, output: string): string[] {
  return [...COMMON_PREFIX, '-i', input, '-c', 'copy', ...faststartArgs(container), output]
}

/**
 * 截取参数：精确重编码（默认）或流复制（关键帧对齐）
 * @param options 起止秒 + fastCopy
 * @param input 输入路径
 * @param output 输出路径（恒为 mp4）
 */
export function buildTrimArgs(options: TrimOptions, input: string, output: string): string[] {
  const base = [
    ...COMMON_PREFIX,
    '-ss',
    secondsArg(options.startSec),
    '-to',
    secondsArg(options.endSec),
    '-i',
    input
  ]
  if (options.fastCopy) return [...base, '-c', 'copy', output]
  return [
    ...base,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    output
  ]
}

/**
 * 目标音频格式 → 编码参数（提取音频与音频互转共用；wav/flac 无损忽略码率）
 * @param format 目标格式
 * @param bitrate 码率 kbps
 */
function audioCodecArgs(format: AudioFormat, bitrate: number): string[] {
  const lossless = format === 'wav' || format === 'flac'
  const rate = lossless ? [] : ['-b:a', `${String(bitrate)}k`]
  return ['-c:a', AUDIO_CODEC[format], ...rate]
}

/**
 * 提取音频参数（wav/flac 无损，忽略码率）
 * @param options 格式 + 码率
 * @param input 输入路径
 * @param output 输出路径
 */
export function buildExtractAudioArgs(
  options: ExtractAudioOptions,
  input: string,
  output: string
): string[] {
  return [
    ...COMMON_PREFIX,
    '-i',
    input,
    '-vn',
    ...audioCodecArgs(options.format, options.bitrate),
    output
  ]
}

/**
 * 音频互转参数（仅音频输入；丢弃封面等附加视频轨；0 = 保持原始采样率/声道）
 * @param options 目标格式 + 码率 + 采样率 + 声道
 * @param input 输入路径
 * @param output 输出路径
 */
export function buildAudioConvertArgs(
  options: AudioConvertOptions,
  input: string,
  output: string
): string[] {
  const sampleRate = options.sampleRate > 0 ? ['-ar', String(options.sampleRate)] : []
  const channels = options.channels > 0 ? ['-ac', String(options.channels)] : []
  return [
    ...COMMON_PREFIX,
    '-i',
    input,
    '-vn',
    ...audioCodecArgs(options.format, options.bitrate),
    ...sampleRate,
    ...channels,
    output
  ]
}

/**
 * 压缩参数：三档质量 + 可选分辨率上限（只缩不放）
 * @param options 质量档 + 分辨率上限（0 = 原尺寸）
 * @param input 输入路径
 * @param output 输出路径
 */
export function buildCompressArgs(
  options: CompressOptions,
  input: string,
  output: string
): string[] {
  const preset = COMPRESS_QUALITY[options.level]
  const scale =
    options.maxHeight === 0
      ? []
      : [
          '-vf',
          `scale=w='min(iw,${String(Math.round((options.maxHeight * 16) / 9))})':h='min(ih,${String(options.maxHeight)})':force_original_aspect_ratio=decrease:force_divisible_by=2`,
          '-pix_fmt',
          'yuv420p'
        ]
  return [
    ...COMMON_PREFIX,
    '-i',
    input,
    ...scale,
    '-c:v',
    'libx264',
    '-preset',
    preset.preset,
    '-crf',
    String(preset.crf),
    '-c:a',
    'aac',
    '-b:a',
    preset.audio,
    '-movflags',
    '+faststart',
    output
  ]
}

/**
 * ffmpeg 失败 stderr → 结构化错误码
 * @param stderr 错误输出
 */
export function classifyFfmpegFailure(stderr: string): MediaConvertErrorCode {
  if (/No space left on device|not enough space/i.test(stderr)) return 'MC_OUTPUT_WRITE_FAILED'
  if (/Permission denied|Access is denied|Read-only file system/i.test(stderr)) {
    return 'MC_OUTPUT_WRITE_FAILED'
  }
  if (
    /Could not find tag for codec|not currently supported in container|Unsupported codec|codec not supported|Could not write header/i.test(
      stderr
    )
  ) {
    return 'MC_CONTAINER_INCOMPATIBLE'
  }
  if (/No such file or directory|could not open/i.test(stderr)) return 'MC_FILE_UNSUPPORTED'
  if (CORRUPT_HINTS.test(stderr)) return 'MC_FILE_CORRUPT'
  return 'MC_FILE_CORRUPT'
}
