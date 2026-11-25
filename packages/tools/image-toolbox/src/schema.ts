/**
 * @file IPC 入参/出参 zod schema 与扩展名归一（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-18
 * @description probe/process/make-gif/config 通道的 payload 与结果形状（spec §4）；
 *              process 按 mode discriminated union（compress/convert/resize/effect）
 */
import { z } from 'zod'
import { GIF_MAX_EDGE, GIF_MAX_FRAME_MS, GIF_MIN_FRAME_MS, MAX_GIF_FRAMES } from './gif'

/** 支持的输入扩展名白名单（小写；大小写不敏感匹配，spec §1） */
export const SUPPORTED_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'avif',
  'gif',
  'bmp',
  'tiff'
] as const

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number]

/** 单文件体积上限（字节，spec §1：200MB） */
export const MAX_FILE_BYTES = 200 * 1024 * 1024

/** 单批文件数上限（M63：与文件夹递归收集上限一致，2000 张） */
export const MAX_BATCH_FILES = 2000

/**
 * 扩展名归一（小写、剥点、jpeg→jpg）；不在白名单 → null
 * @param raw 原始扩展名（可带点，任意大小写）
 */
export function normalizeExtension(raw: string): SupportedExtension | null {
  const ext = raw.replace(/^\./, '').toLowerCase()
  if (ext === 'jpeg') return 'jpg'
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

/** 输入文件列表（zod：非空字符串，去重由调用方负责，上限 MAX_BATCH_FILES） */
export const filesSchema = z.array(z.string().min(1)).min(1).max(MAX_BATCH_FILES)

// —— probe（sync） ——

export const probePayloadSchema = z.object({ files: filesSchema })

/** 单张图片元信息（probe 成功项） */
export const probeItemSchema = z.object({
  file: z.string(),
  format: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sizeBytes: z.number().int().nonnegative(),
  animated: z.boolean()
})

/** probe 失败项（单张失败不阻塞其他，spec §7 批量语义） */
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

// —— 目标格式 ——

/** 目标格式（bmp/tiff 为无损直出，不支持质量参数） */
export const targetFormatSchema = z.enum(['jpg', 'png', 'webp', 'avif', 'bmp', 'tiff'])
export type TargetFormat = z.infer<typeof targetFormatSchema>

// —— compress / convert / resize options（spec §2） ——

export const qualitySchema = z.number().int().min(1).max(100)

/** 压缩参数：质量 + 目标格式（原格式 / 统一 jpg/png/webp/avif） */
export const compressOptionsSchema = z.object({
  quality: qualitySchema,
  target: z.enum(['original', 'jpg', 'png', 'webp', 'avif'])
})

/** 转换参数：目标格式 + 质量（png 忽略质量，前端置灰） */
export const convertOptionsSchema = z.object({
  format: targetFormatSchema,
  quality: qualitySchema
})

/** 缩放参数：四模式 discriminated union + 不放大开关 + 目标格式/质量 */
export const resizeOptionsSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('percent'),
    percent: z.number().int().min(1).max(500),
    noUpscale: z.boolean(),
    format: targetFormatSchema,
    quality: qualitySchema
  }),
  z.object({
    mode: z.literal('width'),
    width: z.number().int().min(1).max(32768),
    noUpscale: z.boolean(),
    format: targetFormatSchema,
    quality: qualitySchema
  }),
  z.object({
    mode: z.literal('height'),
    height: z.number().int().min(1).max(32768),
    noUpscale: z.boolean(),
    format: targetFormatSchema,
    quality: qualitySchema
  }),
  z.object({
    mode: z.literal('fit'),
    fitWidth: z.number().int().min(1).max(32768),
    fitHeight: z.number().int().min(1).max(32768),
    noUpscale: z.boolean(),
    format: targetFormatSchema,
    quality: qualitySchema
  })
])

export type CompressOptions = z.infer<typeof compressOptionsSchema>
export type ConvertOptions = z.infer<typeof convertOptionsSchema>
export type ResizeOptions = z.infer<typeof resizeOptionsSchema>

// —— 旋转 options（M70 §4.48 合并 image-rotate，spec §2.6） ——

/** 旋转角度（顺时针；none = 不旋转） */
export const rotationSchema = z.enum(['none', '90', '180', '270'])
export type Rotation = z.infer<typeof rotationSchema>

/** 翻转方向（none = 不翻转） */
export const flipSchema = z.enum(['none', 'horizontal', 'vertical'])
export type Flip = z.infer<typeof flipSchema>

/** 旋转参数：旋转与翻转可组合，至少选一项（refine 兜底） */
export const rotateOptionsSchema = z
  .object({ rotation: rotationSchema, flip: flipSchema })
  .refine((value) => value.rotation !== 'none' || value.flip !== 'none', {
    message: '请选择旋转角度或翻转方式'
  })
export type RotateOptions = z.infer<typeof rotateOptionsSchema>

// —— 裁剪 options（M70 §4.48 合并 image-crop，spec §2.7） ——

/** 裁剪方式：比例 / 自由区域 */
export const cropModeSchema = z.enum(['ratio', 'free'])
export type CropMode = z.infer<typeof cropModeSchema>

/** 九宫格锚点（比例模式下裁剪窗口在图片中的位置） */
export const anchorSchema = z.enum([
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right'
])
export type CropAnchor = z.infer<typeof anchorSchema>

/**
 * 裁剪参数：扁平对象，按 mode 取用对应字段（默认值便于部分提交）
 * - ratio：ratioW/ratioH（1–100）+ anchor
 * - free：x/y（0–99）+ width/height（1–100），百分比且必须落在图片内
 */
export const cropOptionsSchema = z
  .object({
    mode: cropModeSchema.default('ratio'),
    ratioW: z.number().int().min(1).max(100).default(1),
    ratioH: z.number().int().min(1).max(100).default(1),
    anchor: anchorSchema.default('center'),
    x: z.number().int().min(0).max(99).default(0),
    y: z.number().int().min(0).max(99).default(0),
    width: z.number().int().min(1).max(100).default(100),
    height: z.number().int().min(1).max(100).default(100)
  })
  .refine(
    (value) => value.mode !== 'free' || (value.x + value.width <= 100 && value.y + value.height <= 100),
    { message: '裁剪区域超出图片范围' }
  )
export type CropOptions = z.infer<typeof cropOptionsSchema>

// —— 调整 options（M40，spec §2.4；M55 §4.55 增调色） ——

export const EFFECT_KINDS = ['grayscale', 'invert', 'binary'] as const

/** 调整效果（灰度/反色/黑白二值） */
export const effectKindSchema = z.enum(EFFECT_KINDS)

/** 黑白二值阈值（0–255，仅 binary 生效） */
export const thresholdSchema = z.number().int().min(0).max(255)

/** 调色滑杆（有符号）：亮度/对比度/饱和度 -100..100，0 = 不生效（M55 §4.55） */
export const adjustSignedSchema = z.number().int().min(-100).max(100)

/** 调色滑杆（强度）：锐化/模糊 0..100，0 = 不生效（M55 §4.55） */
export const adjustIntensitySchema = z.number().int().min(0).max(100)

export const effectOptionsSchema = z.object({
  effect: effectKindSchema,
  threshold: thresholdSchema,
  quality: qualitySchema,
  // M55 调色：default(0) 保证旧 payload（无这些字段）与全 0 路径输出逐字节一致
  brightness: adjustSignedSchema.default(0),
  contrast: adjustSignedSchema.default(0),
  saturation: adjustSignedSchema.default(0),
  sharpen: adjustIntensitySchema.default(0),
  blur: adjustIntensitySchema.default(0)
})

export type EffectOptions = z.infer<typeof effectOptionsSchema>

// —— GIF options（M40，spec §2.5） ——

/** 循环次数：-1 不循环 / 0 无限 / 2–10 次（1 次无意义，排除） */
export const gifLoopSchema = z
  .number()
  .int()
  .refine((value) => value === -1 || value === 0 || (value >= 2 && value <= 10), {
    message: '循环次数仅支持 -1（不循环）/ 0（无限）/ 2–10'
  })

/** 目标宽：0 = 按首张图片宽；否则 64–4096 */
export const gifWidthSchema = z.union([z.literal(0), z.number().int().min(64).max(GIF_MAX_EDGE)])

export const gifOptionsSchema = z.object({
  durationMs: z.number().int().min(GIF_MIN_FRAME_MS).max(GIF_MAX_FRAME_MS),
  loop: gifLoopSchema,
  width: gifWidthSchema
})

export type GifOptions = z.infer<typeof gifOptionsSchema>

// —— process（task） ——

export const processPayloadSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('compress'),
    files: filesSchema,
    outputDir: z.string().min(1),
    options: compressOptionsSchema
  }),
  z.object({
    mode: z.literal('convert'),
    files: filesSchema,
    outputDir: z.string().min(1),
    options: convertOptionsSchema
  }),
  z.object({
    mode: z.literal('resize'),
    files: filesSchema,
    outputDir: z.string().min(1),
    options: resizeOptionsSchema
  }),
  z.object({
    mode: z.literal('effect'),
    files: filesSchema,
    outputDir: z.string().min(1),
    options: effectOptionsSchema
  }),
  z.object({
    mode: z.literal('rotate'),
    files: filesSchema,
    outputDir: z.string().min(1),
    options: rotateOptionsSchema
  }),
  z.object({
    mode: z.literal('crop'),
    files: filesSchema,
    outputDir: z.string().min(1),
    options: cropOptionsSchema
  })
])

export type ProcessPayload = z.infer<typeof processPayloadSchema>

// —— make-gif（task，M40，spec §2.5/§4） ——

export const makeGifPayloadSchema = z.object({
  files: z.array(z.string().min(1)).min(1).max(MAX_GIF_FRAMES),
  outputDir: z.string().min(1),
  options: gifOptionsSchema
})

export type MakeGifPayload = z.infer<typeof makeGifPayloadSchema>

/** GIF 生成结果（done 事件） */
export const gifResultSchema = z.object({
  outputPath: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frames: z.number().int().min(1),
  sizeBytes: z.number().int().nonnegative()
})

export type MakeGifResult = z.infer<typeof gifResultSchema>

/** 单张成功输出（前后体积供压缩率展示，spec §4） */
export const outputItemSchema = z.object({
  input: z.string(),
  output: z.string(),
  beforeBytes: z.number().int().nonnegative(),
  afterBytes: z.number().int().nonnegative()
})

/** 单张失败项（批量语义：失败不中断批次） */
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

// —— config（sync） ——

/** 处理历史保留条数（M63：最近 20 条 FIFO） */
export const HISTORY_LIMIT = 20

/** 处理模式（历史记录用；与 Tab 一一对应） */
export const historyModeSchema = z.enum([
  'compress',
  'convert',
  'resize',
  'rotate',
  'crop',
  'effect',
  'gif'
])
export type HistoryMode = z.infer<typeof historyModeSchema>

/** 处理历史条目（M63：时间戳 + 模式 + 成功/失败 + 输出目录 + 首个产物） */
export const historyEntrySchema = z.object({
  at: z.number().int().nonnegative(),
  mode: historyModeSchema,
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  outputDir: z.string().min(1),
  firstOutput: z.string().min(1).nullable()
})
export type HistoryEntry = z.infer<typeof historyEntrySchema>

/** 追加历史入参（时间戳由主进程补齐） */
export const appendHistoryPayloadSchema = historyEntrySchema.omit({ at: true })
export type AppendHistoryPayload = z.infer<typeof appendHistoryPayloadSchema>

/** 历史列表回包（config / append / clear 共用） */
export const historyResultSchema = z.object({
  history: z.array(historyEntrySchema).max(HISTORY_LIMIT)
})
export type HistoryResult = z.infer<typeof historyResultSchema>

export const configResultSchema = z.object({
  outputDir: z.string(),
  history: z.array(historyEntrySchema).max(HISTORY_LIMIT)
})
export type ConfigResult = z.infer<typeof configResultSchema>

// —— collect-folder（sync，M63 文件夹递归） ——

/** 递归收集文件夹内支持图片的入参 */
export const collectFolderPayloadSchema = z.object({ dir: z.string().min(1).max(32767) })
export type CollectFolderPayload = z.infer<typeof collectFolderPayloadSchema>

/** 收集结果：绝对路径（已排序/去重）与是否触达上限 */
export const collectFolderResultSchema = z.object({
  files: z.array(z.string().min(1)).max(MAX_BATCH_FILES),
  truncated: z.boolean()
})
export type CollectFolderResult = z.infer<typeof collectFolderResultSchema>

// —— set-output-dir（sync，输出目录记忆） ——

/** 保存输出目录记忆（renderer 选择目录后即时落盘） */
export const setOutputDirPayloadSchema = z.object({ outputDir: z.string().min(1) })
export type SetOutputDirPayload = z.infer<typeof setOutputDirPayloadSchema>
