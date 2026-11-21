/**
 * @file ffmpeg 参数构造纯函数（spec §5，无副作用）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 四模式参数映射 + 失败分类；统一前置 `-y -v error -progress pipe:1 -nostats`
 */
import { CORRUPT_HINTS } from './media'
import type {
  AudioConvertOptions,
  CompressOptions,
  ExtractAudioOptions,
  QualityLevel,
  TrimOptions
} from './schema'
import type { MediaConvertErrorCode } from './errors'

/** 统一前置（每模式共用） */
export const COMMON_PREFIX = ['-y', '-v', 'error', '-progress', 'pipe:1', '-nostats'] as const

/** 容器 → 视频目标扩展名（与格式一致） */
export type VideoFormat = 'mp4' | 'webm' | 'mkv'

/** 转码质量档 → 视频/音频编码参数（mp4/mkv） */
const MP4_QUALITY: Record<QualityLevel, { crf: number; audio: string }> = {
  high: { crf: 18, audio: '256k' },
  medium: { crf: 23, audio: '192k' },
  low: { crf: 28, audio: '128k' }
}

/** 转码质量档 → VP9/Opus 参数（webm） */
const WEBM_QUALITY: Record<QualityLevel, { crf: number; audio: string }> = {
  high: { crf: 28, audio: '160k' },
  medium: { crf: 32, audio: '128k' },
  low: { crf: 36, audio: '96k' }
}

/** 压缩质量档 → CRF + preset + 音频码率 */
const COMPRESS_QUALITY: Record<QualityLevel, { crf: number; preset: string; audio: string }> = {
  high: { crf: 20, preset: 'medium', audio: '192k' },
  medium: { crf: 26, preset: 'veryfast', audio: '128k' },
  low: { crf: 32, preset: 'veryfast', audio: '96k' }
}

/**
 * 秒 → ffmpeg 时间参数（去掉无意义尾零）
 * @param seconds 秒
 */
function secondsArg(seconds: number): string {
  return String(Number(seconds.toFixed(3)))
}

/**
 * 转码参数：mp4/mkv = H.264+AAC；webm = VP9+Opus
 * @param format 目标容器
 * @param quality 质量档
 * @param input 输入路径
 * @param output 输出路径
 */
export function buildTranscodeArgs(
  format: VideoFormat,
  quality: QualityLevel,
  input: string,
  output: string
): string[] {
  if (format === 'webm') {
    const preset = WEBM_QUALITY[quality]
    return [
      ...COMMON_PREFIX,
      '-i',
      input,
      '-c:v',
      'libvpx-vp9',
      '-crf',
      String(preset.crf),
      '-b:v',
      '0',
      '-c:a',
      'libopus',
      '-b:a',
      preset.audio,
      output
    ]
  }
  const preset = MP4_QUALITY[quality]
  const tail = format === 'mkv' ? [] : ['-movflags', '+faststart']
  return [
    ...COMMON_PREFIX,
    '-i',
    input,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    String(preset.crf),
    '-c:a',
    'aac',
    '-b:a',
    preset.audio,
    ...tail,
    output
  ]
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
 * 目标音频格式 → 编码参数（提取音频与音频互转共用）
 * @param options 目标格式 + 码率
 */
function audioEncodeArgs(options: ExtractAudioOptions | AudioConvertOptions): string[] {
  const codec: Record<ExtractAudioOptions['format'], string> = {
    mp3: 'libmp3lame',
    m4a: 'aac',
    wav: 'pcm_s16le',
    flac: 'flac',
    ogg: 'libvorbis'
  }
  const lossless = options.format === 'wav' || options.format === 'flac'
  const bitrate = lossless ? [] : ['-b:a', `${options.bitrate}k`]
  return ['-c:a', codec[options.format], ...bitrate]
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
  return [...COMMON_PREFIX, '-i', input, '-vn', ...audioEncodeArgs(options), output]
}

/**
 * 音频互转参数（仅音频输入；丢弃封面等附加视频轨）
 * @param options 目标格式 + 码率
 * @param input 输入路径
 * @param output 输出路径
 */
export function buildAudioConvertArgs(
  options: AudioConvertOptions,
  input: string,
  output: string
): string[] {
  return [...COMMON_PREFIX, '-i', input, '-vn', ...audioEncodeArgs(options), output]
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
  if (/No such file or directory|could not open/i.test(stderr)) return 'MC_FILE_UNSUPPORTED'
  if (CORRUPT_HINTS.test(stderr)) return 'MC_FILE_CORRUPT'
  return 'MC_FILE_CORRUPT'
}
