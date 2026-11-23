/**
 * @file 容器×编码兼容矩阵与参数校验（spec §5.1，纯函数无副作用）
 * @author cuilanchao
 * @date 2026-11-23
 * @description 目标容器可用的视频编码、remux 源编码白名单、编码名归一，
 *              以及自定义分辨率合法性；供 schema superRefine、encode 与 node 共用
 */

/** 视频目标容器（重编码与 remux 共用） */
export const VIDEO_CONTAINERS = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'ts', 'm4v'] as const
export type VideoContainer = (typeof VIDEO_CONTAINERS)[number]

/** 可选视频编码（webm 固定 VP9，不走此字段） */
export const VIDEO_CODECS = ['h264', 'h265'] as const
export type VideoCodec = (typeof VIDEO_CODECS)[number]

/** 音频目标格式（提取音频为前 5 种，音频互转含全部 7 种） */
export const AUDIO_FORMATS = ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'aac', 'opus'] as const
export type AudioFormat = (typeof AUDIO_FORMATS)[number]

/** 允许 H.265 的容器（其余容器固定 H.264 或 VP9） */
const H265_CONTAINERS: readonly VideoContainer[] = ['mp4', 'm4v', 'mov', 'mkv']

/** 需要 `-movflags +faststart` 的容器 */
const FASTSTART_CONTAINERS: readonly VideoContainer[] = ['mp4', 'm4v', 'mov']

/**
 * 容器是否暴露编码器选择（H.264 / H.265）
 * @param container 目标容器
 */
export function codecSelectable(container: VideoContainer): boolean {
  return H265_CONTAINERS.includes(container)
}

/**
 * 是否需 `-movflags +faststart`（网络渐进播放）
 * @param container 目标容器
 */
export function needsFaststart(container: VideoContainer): boolean {
  return FASTSTART_CONTAINERS.includes(container)
}

/**
 * 容器 × 编码器组合校验
 * @param container 目标容器
 * @param codec 用户选择的视频编码
 * @returns null = 合法，否则中文原因
 */
export function containerCodecError(container: VideoContainer, codec: VideoCodec): string | null {
  if (codec === 'h265' && !codecSelectable(container)) {
    return `${container.toUpperCase()} 格式不支持 H.265，请改选 H.264 或其他格式`
  }
  return null
}

/** remux 目标容器允许的源视频编码（编码名已归一） */
const REMUX_VIDEO: Record<VideoContainer, readonly string[]> = {
  mp4: ['h264', 'h265', 'mpeg4'],
  m4v: ['h264', 'h265', 'mpeg4'],
  mov: ['h264', 'h265', 'mpeg4'],
  mkv: ['h264', 'h265', 'vp8', 'vp9', 'av1', 'mpeg4', 'mpeg2video'],
  webm: ['vp8', 'vp9', 'av1'],
  avi: ['h264', 'mpeg4', 'mjpeg'],
  flv: ['h264'],
  ts: ['h264', 'h265', 'mpeg2video']
}

/** remux 目标容器允许的源音频编码（编码名已归一） */
const REMUX_AUDIO: Record<VideoContainer, readonly string[]> = {
  mp4: ['aac', 'mp3', 'alac', 'ac3'],
  m4v: ['aac', 'mp3', 'alac', 'ac3'],
  mov: ['aac', 'mp3', 'alac', 'ac3'],
  mkv: ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'alac', 'ac3', 'pcm_s16le'],
  webm: ['opus', 'vorbis'],
  avi: ['mp3', 'ac3', 'pcm_s16le'],
  flv: ['aac', 'mp3'],
  ts: ['aac', 'mp3', 'ac3']
}

/**
 * 视频编码名归一（ffmpeg probe 名 → 矩阵键）
 * @param raw probe 得到的编码名（如 hevc / h264）
 */
export function normalizeVideoCodec(raw: string): string {
  const lower = raw.trim().toLowerCase()
  if (lower === 'hevc' || lower === 'hvc1' || lower === 'hev1') return 'h265'
  if (lower === 'avc1' || lower === 'avc3') return 'h264'
  return lower
}

/**
 * 音频编码名归一（pcm 家族统一按 pcm_s16le 判定）
 * @param raw probe 得到的编码名（如 aac / pcm_s24le）
 */
export function normalizeAudioCodec(raw: string): string {
  const lower = raw.trim().toLowerCase()
  if (lower.startsWith('pcm_')) return 'pcm_s16le'
  if (lower === 'mp3float') return 'mp3'
  return lower
}

/**
 * remux 兼容判定（源编码是否可直接 `-c copy` 到目标容器）
 * @param container 目标容器
 * @param videoCodec 源视频编码（probe 原始名；null = 无视频轨）
 * @param audioCodec 源音频编码（probe 原始名；null = 无音频轨）
 */
export function canRemux(
  container: VideoContainer,
  videoCodec: string | null,
  audioCodec: string | null
): boolean {
  if (videoCodec === null) return false
  const video = normalizeVideoCodec(videoCodec)
  if (!REMUX_VIDEO[container].includes(video)) return false
  if (audioCodec === null) return true
  return REMUX_AUDIO[container].includes(normalizeAudioCodec(audioCodec))
}

/**
 * remux 兼容校验
 * @returns null = 兼容，否则中文原因
 */
export function remuxError(
  container: VideoContainer,
  videoCodec: string | null,
  audioCodec: string | null
): string | null {
  return canRemux(container, videoCodec, audioCodec)
    ? null
    : `当前文件编码（${videoCodec ?? '无视频'}${audioCodec === null ? '' : `/${audioCodec}`}）与 ${container.toUpperCase()} 不兼容，请改用重新编码`
}

/** 自定义分辨率上限（与 schema 一致） */
const MAX_DIMENSION = 7680
/** 自定义分辨率下限 */
const MIN_DIMENSION = 16

/** 分辨率参数（与 schema discriminated union 同形） */
export interface ResolutionOption {
  kind: 'original' | 'maxHeight' | 'custom'
  width?: number
  height?: number
}

/**
 * 自定义分辨率合法性（仅 custom 分支校验）
 * @param resolution 分辨率参数
 * @returns null = 合法，否则中文原因
 */
export function resolutionError(resolution: ResolutionOption): string | null {
  if (resolution.kind !== 'custom') return null
  const width = resolution.width ?? 0
  const height = resolution.height ?? 0
  if (
    width < MIN_DIMENSION ||
    width > MAX_DIMENSION ||
    height < MIN_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    return `自定义分辨率需在 ${String(MIN_DIMENSION)}–${String(MAX_DIMENSION)} 之间`
  }
  if (width % 2 !== 0 || height % 2 !== 0) return '自定义分辨率宽高必须为偶数'
  return null
}
