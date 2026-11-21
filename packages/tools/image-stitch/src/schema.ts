/**
 * @file schema.ts
 * @author cuilanchao
 * @date 2026-11-20
 * @description image-stitch IPC 入参/回参 zod 契约与 worker 请求/结果类型
 *              （白名单、上限与默认值同源，spec §5.1）
 */
import { z } from 'zod'

/** 输入图片白名单（png/jpg/webp，大小写不敏感） */
export const IMAGE_INPUT_RE = /\.(png|jpe?g|webp)$/i

/** 单批最多图片张数（spec §1.2） */
export const MAX_IMAGES = 100

/** 单张图片最大字节（40MB） */
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024

/** 背景色（#RRGGBB，不含 alpha） */
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** 布局模式（顺序与界面单选一致） */
export const STITCH_MODES = ['vertical', 'horizontal', 'grid'] as const
export type StitchMode = (typeof STITCH_MODES)[number]

/** 基准尺寸来源 */
export const SIZE_MODES = ['first', 'max', 'fixed'] as const
export type SizeMode = (typeof SIZE_MODES)[number]

/** 输出编码器（用户选择，不跟随输入） */
export const ENCODERS = ['png', 'jpeg', 'webp'] as const
export type ImageEncoder = (typeof ENCODERS)[number]

/** 数值边界（spec §1.2 同源） */
export const LIMITS = {
  minFixedSize: 100,
  maxFixedSize: 10_000,
  minColumns: 2,
  maxColumns: 8,
  maxGutter: 100,
  maxPadding: 100,
  minQuality: 60,
  maxQuality: 100
} as const

/** 布局参数（spec §5.1） */
export const layoutSchema = z.object({
  mode: z.enum(STITCH_MODES),
  sizeMode: z.enum(SIZE_MODES),
  /** 固定基准边长（sizeMode = fixed 时生效） */
  fixedSize: z
    .number()
    .int()
    .min(LIMITS.minFixedSize, `固定尺寸最小 ${LIMITS.minFixedSize}px`)
    .max(LIMITS.maxFixedSize, `固定尺寸最大 ${LIMITS.maxFixedSize}px`),
  /** 网格列数（mode = grid 时生效） */
  columns: z
    .number()
    .int()
    .min(LIMITS.minColumns, `列数最小 ${LIMITS.minColumns}`)
    .max(LIMITS.maxColumns, `列数最大 ${LIMITS.maxColumns}`),
  /** 图片间距 px */
  gutter: z.number().int().min(0, '间距不能为负').max(LIMITS.maxGutter, `间距最大 ${LIMITS.maxGutter}px`),
  /** 外边距 px */
  padding: z
    .number()
    .int()
    .min(0, '外边距不能为负')
    .max(LIMITS.maxPadding, `外边距最大 ${LIMITS.maxPadding}px`)
})

export type LayoutOptions = z.infer<typeof layoutSchema>

export const stitchPayloadSchema = z.object({
  inputPaths: z
    .array(z.string().min(1).regex(IMAGE_INPUT_RE, '仅支持 PNG/JPG/WebP 图片'))
    .min(1, '请至少选择一张图片')
    .max(MAX_IMAGES, `单次最多 ${MAX_IMAGES} 张图片`),
  layout: layoutSchema,
  encoder: z.enum(ENCODERS),
  quality: z
    .number()
    .int()
    .min(LIMITS.minQuality, `质量最小 ${LIMITS.minQuality}`)
    .max(LIMITS.maxQuality, `质量最大 ${LIMITS.maxQuality}`),
  bgColor: z.string().regex(COLOR_RE, '背景色需为 #RRGGBB'),
  /** 输出目录；缺省用记忆目录/userData 默认 */
  outputDir: z.string().min(1).optional()
})

export type StitchPayload = z.infer<typeof stitchPayloadSchema>

export const setOutputDirPayloadSchema = z.object({
  outputDir: z.string().min(1, '请选择输出目录')
})

export type SetOutputDirPayload = z.infer<typeof setOutputDirPayloadSchema>

/** `image-stitch:config` 返回（记忆的输出目录） */
export const configResultSchema = z.object({ outputDir: z.string().min(1) })
export type ConfigResult = z.infer<typeof configResultSchema>

/** `image-stitch:stitch` done 结果 */
export interface StitchResult {
  outputPath: string
  width: number
  height: number
  count: number
}

/** worker 请求（node 侧已解析输出目录） */
export interface StitchRequest {
  inputPaths: string[]
  layout: LayoutOptions
  encoder: ImageEncoder
  quality: number
  bgColor: string
  outputDir: string
}

// —— M40 长图分割（spec §5.1–§5.4） ——

/** 分割方式 */
export const SPLIT_MODES = ['height', 'parts'] as const
export type SplitModeValue = (typeof SPLIT_MODES)[number]

/** 分割数值边界（与 §3.6 一致） */
export const SPLIT_LIMITS = {
  minHeight: 50,
  maxHeight: 30_000,
  minParts: 2,
  maxParts: 50
} as const

export const splitPayloadSchema = z.object({
  inputPath: z.string().min(1).regex(IMAGE_INPUT_RE, '仅支持 PNG/JPG/WebP 图片'),
  mode: z.enum(SPLIT_MODES),
  height: z.number().int().min(SPLIT_LIMITS.minHeight).max(SPLIT_LIMITS.maxHeight),
  parts: z.number().int().min(SPLIT_LIMITS.minParts).max(SPLIT_LIMITS.maxParts),
  quality: z
    .number()
    .int()
    .min(LIMITS.minQuality, `质量最小 ${LIMITS.minQuality}`)
    .max(LIMITS.maxQuality, `质量最大 ${LIMITS.maxQuality}`),
  /** 输出目录；缺省用记忆目录/userData 默认 */
  outputDir: z.string().min(1).optional()
})

export type SplitPayload = z.infer<typeof splitPayloadSchema>

/** split worker 请求（node 侧已解析输出目录） */
export interface SplitRequest {
  inputPath: string
  mode: SplitModeValue
  height: number
  parts: number
  quality: number
  outputDir: string
}

/** 单段输出 */
export interface SplitOutput {
  path: string
  width: number
  height: number
}

/** `image-stitch:split` done 结果 */
export interface SplitResult {
  outputs: SplitOutput[]
  sourceWidth: number
  sourceHeight: number
}
