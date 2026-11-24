/**
 * @file schema.ts 图片去水印 IPC 契约与 worker 请求/结果类型
 * @author cuilanchao
 * @date 2026-11-24
 * @description 白名单、上限与默认值同源（spec §5.1）
 */
import { z } from 'zod'

/** 输入图片白名单（png/jpg/webp，大小写不敏感） */
export const IMAGE_INPUT_RE = /\.(png|jpe?g|webp)$/i

/** 单张图片最大字节（40MB） */
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024

/** 单边最大像素（10000×10000） */
export const MAX_DIMENSION = 10_000

/** 最多框选区域数 */
export const MAX_REGIONS = 20

/** 区域最小宽/高（像素） */
export const MIN_REGION_SIZE = 2

/** 填充模式（顺序与界面一致，首项为默认） */
export const FILL_MODES = ['inpaint', 'blur', 'solid'] as const
export type FillMode = (typeof FILL_MODES)[number]

/** 模糊半径范围（像素） */
export const MIN_BLUR_RADIUS = 4
export const MAX_BLUR_RADIUS = 40
export const DEFAULT_BLUR_RADIUS = 12

/** 输出编码器（跟随原扩展名） */
export const ENCODERS = ['png', 'jpeg', 'webp'] as const
export type Encoder = (typeof ENCODERS)[number]

/** 原图像素矩形（x/y 左上角，宽高为正整数） */
export const regionSchema = z.object({
  x: z.number().int().min(0, '区域坐标不能为负').max(MAX_DIMENSION, '区域超出图片范围'),
  y: z.number().int().min(0, '区域坐标不能为负').max(MAX_DIMENSION, '区域超出图片范围'),
  width: z
    .number()
    .int()
    .min(MIN_REGION_SIZE, `区域宽高至少 ${MIN_REGION_SIZE}px`)
    .max(MAX_DIMENSION, '区域超出图片范围'),
  height: z
    .number()
    .int()
    .min(MIN_REGION_SIZE, `区域宽高至少 ${MIN_REGION_SIZE}px`)
    .max(MAX_DIMENSION, '区域超出图片范围')
})

export type Region = z.infer<typeof regionSchema>

export const dewatermarkPayloadSchema = z.object({
  inputPath: z.string().min(1, '请选择图片').regex(IMAGE_INPUT_RE, '仅支持 PNG/JPG/WebP 图片'),
  regions: z
    .array(regionSchema)
    .min(1, '请先框选至少一个区域')
    .max(MAX_REGIONS, `最多框选 ${MAX_REGIONS} 个区域`),
  mode: z.enum(FILL_MODES),
  blurRadius: z
    .number()
    .min(MIN_BLUR_RADIUS, `模糊半径最小 ${MIN_BLUR_RADIUS}px`)
    .max(MAX_BLUR_RADIUS, `模糊半径最大 ${MAX_BLUR_RADIUS}px`)
    .default(DEFAULT_BLUR_RADIUS),
  /** 输出目录；缺省用记忆目录/userData 默认 */
  outputDir: z.string().min(1).optional()
})

export type DewatermarkPayload = z.infer<typeof dewatermarkPayloadSchema>

export const setOutputDirPayloadSchema = z.object({
  outputDir: z.string().min(1, '请选择输出目录')
})

export type SetOutputDirPayload = z.infer<typeof setOutputDirPayloadSchema>

/** `image-dewatermark:config` 返回（记忆的输出目录） */
export const configResultSchema = z.object({ outputDir: z.string().min(1) })
export type ConfigResult = z.infer<typeof configResultSchema>

/** `image-dewatermark:dewatermark` done 结果 */
export interface DewatermarkResult {
  /** 产物绝对路径 */
  output: string
  /** 降级/提示（如大区域改用模糊） */
  warnings: string[]
}

/** worker 请求（node 侧已解析输出目录） */
export interface DewatermarkRequest {
  inputPath: string
  outputDir: string
  regions: Region[]
  mode: FillMode
  blurRadius: number
}
