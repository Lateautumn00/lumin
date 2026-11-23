/**
 * @file IPC 入参/出参 zod schema 与扩展名归一（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-19
 * @description probe/process/config 三通道的 payload 与结果形状（spec §4）；
 *              process 按 mode discriminated union（transcode/trim/extract-audio/audio-convert/compress）
 */
import { z } from 'zod'
import {
  AUDIO_FORMATS,
  VIDEO_CODECS,
  VIDEO_CONTAINERS,
  containerCodecError,
  resolutionError
} from './compat'

/** 视频扩展名白名单（小写；大小写不敏感匹配，spec §1.1） */
export const VIDEO_EXTENSIONS = [
  'mp4',
  'm4v',
  'mov',
  'mkv',
  'webm',
  'avi',
  'flv',
  'wmv',
  'ts',
  'mpg',
  'mpeg',
  '3gp'
] as const

/** 音频扩展名白名单（小写；提取音频 Tab 同时接受视频） */
export const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'flac',
  'aac',
  'm4a',
  'ogg',
  'opus',
  'wma',
  'aiff'
] as const

/** 支持的输入扩展名全集（spec §1.1） */
export const SUPPORTED_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS] as const

export type VideoExtension = (typeof VIDEO_EXTENSIONS)[number]
export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number]
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number]

/** 单文件体积上限（字节，spec §1：4GB） */
export const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024

/** 单批文件数上限（spec §1：1–50） */
export const MAX_BATCH_FILES = 50

/** 单段截取时长上限（秒，spec §2.2：24h） */
export const MAX_TRIM_SEC = 24 * 60 * 60

/**
 * 扩展名归一（小写、剥点）；不在白名单 → null
 * @param raw 原始扩展名（可带点，任意大小写）
 */
export function normalizeExtension(raw: string): SupportedExtension | null {
  const ext = raw.replace(/^\./, '').toLowerCase()
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as SupportedExtension)
    : null
}

/**
 * 从文件路径提取归一扩展名；无法识别 → null
 * @param filePath 磁盘绝对路径
 */
export function extensionOf(filePath: string): SupportedExtension | null {
  const idx = filePath.lastIndexOf('.')
  if (idx <= filePath.lastIndexOf('/') || idx <= filePath.lastIndexOf('\\')) return null
  return normalizeExtension(filePath.slice(idx))
}

/**
 * 是否视频扩展名（决定 Tab 可选输入与流校验口径）
 * @param ext 归一扩展名
 */
export function isVideoExtension(ext: SupportedExtension): ext is VideoExtension {
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext)
}

/**
 * 是否音频扩展名（音频互转 Tab 的输入口径）
 * @param ext 归一扩展名
 */
export function isAudioExtension(ext: SupportedExtension): ext is AudioExtension {
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext)
}

/** 输入文件列表（zod：非空字符串，去重由调用方负责，上限 MAX_BATCH_FILES） */
export const filesSchema = z.array(z.string().min(1)).min(1).max(MAX_BATCH_FILES)

// —— probe（sync） ——

export const probePayloadSchema = z.object({ files: filesSchema })

/** 视频流信息（probe 成功项；无视频轨 → null） */
export const videoStreamSchema = z.object({
  codec: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive()
})

/** 音频流信息（probe 成功项；无音频轨 → null） */
export const audioStreamSchema = z.object({
  codec: z.string(),
  sampleRate: z.number().int().positive(),
  channels: z.number().int().positive()
})

/** 单文件元信息（probe 成功项，spec §4） */
export const probeItemSchema = z.object({
  file: z.string(),
  durationSec: z.number().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  video: videoStreamSchema.nullable(),
  audio: audioStreamSchema.nullable()
})

/** probe 失败项（单个失败不阻塞其他，spec §7 批量语义） */
export const probeFailureSchema = z.object({
  file: z.string(),
  code: z.string(),
  message: z.string()
})

export const probeResultSchema = z.object({
  items: z.array(probeItemSchema),
  failures: z.array(probeFailureSchema)
})

export type ProbePayload = z.infer<typeof probePayloadSchema>
export type ProbeItem = z.infer<typeof probeItemSchema>
export type ProbeFailure = z.infer<typeof probeFailureSchema>
export type ProbeResult = z.infer<typeof probeResultSchema>
export type VideoStream = z.infer<typeof videoStreamSchema>
export type AudioStream = z.infer<typeof audioStreamSchema>

// —— 四 Tab 参数（spec §2） ——

/** 转码质量档（转码 / 压缩共用） */
export const qualityLevelSchema = z.enum(['high', 'medium', 'low'])
export type QualityLevel = z.infer<typeof qualityLevelSchema>

/** 音频码率档（有损格式；无损格式忽略） */
const audioBitrateSchema = z.union([z.literal(128), z.literal(192), z.literal(320)])

/** 分辨率：原始 / 高度上限（只缩不放）/ 自定义宽高（偶数、16–7680） */
export const resolutionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('original') }),
  z.object({
    kind: z.literal('maxHeight'),
    height: z.union([z.literal(480), z.literal(720), z.literal(1080)])
  }),
  z.object({
    kind: z.literal('custom'),
    width: z.number().int().min(16).max(7680),
    height: z.number().int().min(16).max(7680)
  })
])

/** 格式转换参数：容器 + 方式 + 编码器 + 质量/分辨率/帧率/码率/去音轨 */
export const transcodeOptionsSchema = z
  .object({
    format: z.enum(VIDEO_CONTAINERS),
    mode: z.enum(['encode', 'remux']),
    quality: qualityLevelSchema,
    codec: z.enum(VIDEO_CODECS),
    resolution: resolutionSchema,
    fps: z.union([z.literal(0), z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
    videoBitrateKbps: z.number().int().min(0).max(50000),
    audioBitrateKbps: z.union([
      z.literal(64),
      z.literal(96),
      z.literal(128),
      z.literal(160),
      z.literal(192),
      z.literal(256),
      z.literal(320)
    ]),
    removeAudio: z.boolean()
  })
  .superRefine((value, ctx) => {
    // remux 不做编码，编码器/分辨率与产物无关，跳过组合校验
    if (value.mode === 'remux') return
    const codecError = containerCodecError(value.format, value.codec)
    if (codecError !== null) ctx.addIssue({ code: 'custom', message: codecError, path: ['codec'] })
    const resError = resolutionError(value.resolution)
    if (resError !== null) {
      ctx.addIssue({ code: 'custom', message: resError, path: ['resolution'] })
    }
  })

/** 截取参数：起止秒 + 快速流复制开关（区间合法性由 `trimRangeError` 校验） */
export const trimOptionsSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().positive().max(MAX_TRIM_SEC),
  fastCopy: z.boolean()
})

/** 提取音频参数：格式 + 码率（wav/flac 无损忽略码率） */
export const extractAudioOptionsSchema = z.object({
  format: z.enum(['mp3', 'm4a', 'wav', 'flac', 'ogg']),
  bitrate: audioBitrateSchema
})

/** 音频互转参数：目标格式（7 种）+ 码率 + 采样率 + 声道（0 = 保持原始） */
export const audioConvertOptionsSchema = z.object({
  format: z.enum(AUDIO_FORMATS),
  bitrate: audioBitrateSchema,
  sampleRate: z.union([z.literal(0), z.literal(44100), z.literal(48000)]),
  channels: z.union([z.literal(0), z.literal(1), z.literal(2)])
})

/** 压缩参数：质量档 + 分辨率上限（0 = 原尺寸） */
export const compressOptionsSchema = z.object({
  level: qualityLevelSchema,
  maxHeight: z.union([z.literal(0), z.literal(480), z.literal(720), z.literal(1080)])
})

export type TranscodeOptions = z.infer<typeof transcodeOptionsSchema>
export type Resolution = z.infer<typeof resolutionSchema>
export type TrimOptions = z.infer<typeof trimOptionsSchema>
export type ExtractAudioOptions = z.infer<typeof extractAudioOptionsSchema>
export type AudioConvertOptions = z.infer<typeof audioConvertOptionsSchema>
export type CompressOptions = z.infer<typeof compressOptionsSchema>

/**
 * 截取区间合法性（纯函数；null = 合法，否则返回中文原因）
 * @param options zod 校验后的截取参数
 */
export function trimRangeError(options: TrimOptions): string | null {
  if (options.endSec <= options.startSec) return '结束时间必须大于开始时间'
  if (options.endSec - options.startSec > MAX_TRIM_SEC) return '截取片段不能超过 24 小时'
  return null
}

// —— process（task） ——

export const processPayloadSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('transcode'),
    files: filesSchema,
    outputDir: z.string().min(1),
    options: transcodeOptionsSchema
  }),
  z.object({
    mode: z.literal('trim'),
    files: filesSchema,
    outputDir: z.string().min(1),
    options: trimOptionsSchema
  }),
  z.object({
    mode: z.literal('extract-audio'),
    files: filesSchema,
    outputDir: z.string().min(1),
    options: extractAudioOptionsSchema
  }),
  z.object({
    mode: z.literal('audio-convert'),
    files: filesSchema,
    outputDir: z.string().min(1),
    options: audioConvertOptionsSchema
  }),
  z.object({
    mode: z.literal('compress'),
    files: filesSchema,
    outputDir: z.string().min(1),
    options: compressOptionsSchema
  })
])

export type ProcessPayload = z.infer<typeof processPayloadSchema>
export type ProcessMode = ProcessPayload['mode']

/** 单文件成功输出（前后体积 + 时长供结果展示，spec §4） */
export const outputItemSchema = z.object({
  input: z.string(),
  output: z.string(),
  durationSec: z.number().nonnegative(),
  beforeBytes: z.number().int().nonnegative(),
  afterBytes: z.number().int().nonnegative()
})

/** 单文件失败项（批量语义：失败不中断批次） */
export const processFailureSchema = z.object({
  input: z.string(),
  code: z.string(),
  message: z.string()
})

export const processResultSchema = z.object({
  outputs: z.array(outputItemSchema),
  failures: z.array(processFailureSchema)
})

export type OutputItem = z.infer<typeof outputItemSchema>
export type ProcessFailure = z.infer<typeof processFailureSchema>
export type ProcessResult = z.infer<typeof processResultSchema>

// —— config / set-output-dir（sync） ——

export const configResultSchema = z.object({ outputDir: z.string() })
export type ConfigResult = z.infer<typeof configResultSchema>

/** 保存输出目录记忆（renderer 选择目录后即时落盘） */
export const setOutputDirPayloadSchema = z.object({ outputDir: z.string().min(1) })
export type SetOutputDirPayload = z.infer<typeof setOutputDirPayloadSchema>
