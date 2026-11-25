/**
 * @file schema.ts
 * @author cuilanchao
 * @date 2026-11-20
 * @description image-watermark IPC 入参/回参 zod 契约与 worker 请求/结果类型
 *              （白名单、上限与默认值同源，spec §5.1）
 */
import { z } from 'zod'

/** 输入图片白名单（png/jpg/webp，大小写不敏感） */
export const IMAGE_INPUT_RE = /\.(png|jpe?g|webp)$/i

/** 单批最多图片张数（spec §1.2） */
export const MAX_IMAGES = 100

/** 单张图片最大字节（40MB） */
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024

/** 水印图片最大字节（5MB） */
export const MAX_WATERMARK_BYTES = 5 * 1024 * 1024

/** 水印文字最大长度 */
export const MAX_TEXT_LEN = 100

/** 文字颜色（#RRGGBB） */
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** 九宫格位置（顺序与界面按钮一致） */
export const POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
] as const

export type Position = (typeof POSITIONS)[number]

/** 输出编码器（跟随原扩展名） */
export const ENCODERS = ['png', 'jpeg', 'webp'] as const
export type Encoder = (typeof ENCODERS)[number]

/** 两类水印共享的几何参数（spec §5.1） */
const watermarkBaseSchema = z.object({
  /** 字号 / 宽度：占图片短边百分比 */
  sizePct: z.number().min(2, '大小最小 2%').max(50, '大小最大 50%'),
  /** 不透明度百分比 */
  opacity: z.number().min(5, '不透明度最小 5%').max(100, '不透明度最大 100%'),
  /** 旋转角度（顺时针为正） */
  rotation: z.number().min(-180, '角度最小 -180°').max(180, '角度最大 180°'),
  position: z.enum(POSITIONS),
  /** 边距：占图片短边百分比（平铺时忽略） */
  marginPct: z.number().min(0, '边距最小 0%').max(20, '边距最大 20%'),
  /** 平铺（忽略位置与边距） */
  tile: z.boolean()
})

/** 文字水印 */
export const textWatermarkSchema = watermarkBaseSchema.extend({
  type: z.literal('text'),
  text: z
    .string()
    .max(MAX_TEXT_LEN, `水印文字最多 ${MAX_TEXT_LEN} 字`)
    .refine((value) => value.trim() !== '', '水印文字不能为空'),
  color: z.string().regex(COLOR_RE, '颜色需为 #RRGGBB')
})

export type TextWatermark = z.infer<typeof textWatermarkSchema>

/** 图片水印 */
export const imageWatermarkSchema = watermarkBaseSchema.extend({
  type: z.literal('image'),
  watermarkPath: z
    .string()
    .min(1, '请选择水印图片')
    .regex(IMAGE_INPUT_RE, '仅支持 PNG/JPG/WebP 水印图片')
})

export type ImageWatermark = z.infer<typeof imageWatermarkSchema>

/** 水印联合类型（按 type 判别） */
export const watermarkSchema = z.discriminatedUnion('type', [
  textWatermarkSchema,
  imageWatermarkSchema
])

export type Watermark = z.infer<typeof watermarkSchema>

export const watermarkPayloadSchema = z.object({
  inputPaths: z
    .array(z.string().min(1).regex(IMAGE_INPUT_RE, '仅支持 PNG/JPG/WebP 图片'))
    .min(1, '请至少选择一张图片')
    .max(MAX_IMAGES, `单次最多 ${MAX_IMAGES} 张图片`),
  watermark: watermarkSchema,
  /** 输出目录；缺省用记忆目录/userData 默认 */
  outputDir: z.string().min(1).optional()
})

export type WatermarkPayload = z.infer<typeof watermarkPayloadSchema>

export const setOutputDirPayloadSchema = z.object({
  outputDir: z.string().min(1, '请选择输出目录')
})

export type SetOutputDirPayload = z.infer<typeof setOutputDirPayloadSchema>

/** `image-watermark:config` 返回（记忆的输出目录） */
export const configResultSchema = z.object({ outputDir: z.string().min(1) })
export type ConfigResult = z.infer<typeof configResultSchema>

/** 单项失败（单张失败不中断整批） */
export interface WatermarkFailure {
  file: string
  code: string
  message: string
  detail?: string
}

/** `image-watermark:watermark` done 结果 */
export interface WatermarkResult {
  outputs: string[]
  failures: WatermarkFailure[]
}

/** worker 请求（node 侧已解析输出目录） */
export interface WatermarkRequest {
  inputPaths: string[]
  watermark: Watermark
  outputDir: string
}
