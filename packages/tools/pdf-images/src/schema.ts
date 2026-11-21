/**
 * @file schema.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description pdf-images IPC 入参/回参 zod 契约与 worker 请求/结果类型（常量与白名单同源）
 */
import { z } from 'zod'

/** PDF 输入白名单 */
export const PDF_INPUT_RE = /\.pdf$/i

/** 图片输入白名单（png/jpg 直嵌，其余走 ffmpeg 中间转码） */
export const IMAGE_INPUT_RE = /\.(png|jpe?g|webp|bmp|tiff?|avif|gif)$/i

/** 图片→PDF 单次最多张数（spec §3.2） */
export const MAX_IMAGES = 200

/** 页码范围输入最大长度（防超长 payload） */
export const MAX_RANGES_LEN = 2000

/** 支持的渲染分辨率（DPI） */
export const DPI_VALUES = [72, 150, 300] as const
export type Dpi = (typeof DPI_VALUES)[number]

/** PDF→图片输出格式（jpeg 落盘扩展名统一 .jpg） */
export const IMAGE_FORMATS = ['png', 'jpeg'] as const
export type OutputImageFormat = (typeof IMAGE_FORMATS)[number]

/** 图片→PDF 页面模式：auto = 跟随图片尺寸单页；a4/letter = 固定纸型等比居中并留边距 */
export const PAGE_SIZES = ['auto', 'a4', 'letter'] as const
export type PageSizeMode = (typeof PAGE_SIZES)[number]

/** 固定纸型的页面方向：auto = 跟随图片宽高；portrait/landscape = 强制 */
export const PAGE_ORIENTATIONS = ['auto', 'portrait', 'landscape'] as const
export type PageOrientation = (typeof PAGE_ORIENTATIONS)[number]

/** A4 页边距上限（mm） */
export const MAX_MARGIN_MM = 50

/** 自定义输出文件名长度上限 */
export const MAX_OUTPUT_NAME_LEN = 80

/** Windows 文件名非法字符（路径分隔符与保留符号） */
const OUTPUT_NAME_INVALID_RE = /[\\/:*?"<>|]/

/** 自定义输出文件名：去首尾空白、禁非法字符与结尾点/空格（`pdf` 后缀由命名函数统一补） */
export const outputNameSchema = z
  .string()
  .trim()
  .min(1, '输出文件名不能为空')
  .max(MAX_OUTPUT_NAME_LEN, `输出文件名最长 ${MAX_OUTPUT_NAME_LEN} 字符`)
  .refine((value) => !OUTPUT_NAME_INVALID_RE.test(value), '输出文件名不能包含 \\ / : * ? " < > |')
  .refine((value) => !/[. ]$/.test(value), '输出文件名不能以点或空格结尾')

export const pdfInfoPayloadSchema = z.object({
  inputPath: z.string().min(1).regex(PDF_INPUT_RE, '仅支持 PDF 文件')
})

export type PdfInfoPayload = z.infer<typeof pdfInfoPayloadSchema>

export const pdfToImagesPayloadSchema = z.object({
  inputPath: z.string().min(1).regex(PDF_INPUT_RE, '仅支持 PDF 文件'),
  /** 页码范围 `1-3,5`；空串 = 全部页 */
  ranges: z.string().max(MAX_RANGES_LEN, '页码范围过长'),
  format: z.enum(IMAGE_FORMATS),
  dpi: z.union([z.literal(72), z.literal(150), z.literal(300)]),
  /** 输出目录；缺省用记忆目录/文档目录 */
  outputDir: z.string().min(1).optional()
})

export type PdfToImagesPayload = z.infer<typeof pdfToImagesPayloadSchema>

export const imagesToPdfPayloadSchema = z.object({
  inputPaths: z
    .array(z.string().min(1).regex(IMAGE_INPUT_RE, '仅支持常见图片格式'))
    .min(1, '至少添加一张图片')
    .max(MAX_IMAGES, `单次最多 ${MAX_IMAGES} 张图片`),
  pageSize: z.enum(PAGE_SIZES),
  orientation: z.enum(PAGE_ORIENTATIONS).default('auto'),
  marginMm: z.number().min(0).max(MAX_MARGIN_MM, `页边距最大 ${MAX_MARGIN_MM} mm`),
  outputName: outputNameSchema.optional(),
  outputDir: z.string().min(1).optional()
})

export type ImagesToPdfPayload = z.infer<typeof imagesToPdfPayloadSchema>

export const setOutputDirPayloadSchema = z.object({
  outputDir: z.string().min(1)
})

export type SetOutputDirPayload = z.infer<typeof setOutputDirPayloadSchema>

/** `pdf-images:config` 返回（记忆的输出目录） */
export const configResultSchema = z.object({ outputDir: z.string() })
export type ConfigResult = z.infer<typeof configResultSchema>

/** `pdf-images:pdf-info` 返回 */
export const pdfInfoResultSchema = z.object({
  pageCount: z.number().int().min(1),
  fileName: z.string().min(1)
})
export type PdfInfoResult = z.infer<typeof pdfInfoResultSchema>

/** 单项失败（单页/单图失败不中断整批） */
export interface PdfImagesFailure {
  file: string
  code: string
  message: string
  detail?: string
}

/** `pdf-to-images` done 结果 */
export interface PdfToImagesResult {
  outputs: string[]
  pages: number
  outputDir: string
  failures: PdfImagesFailure[]
}

/** `images-to-pdf` done 结果 */
export interface ImagesToPdfResult {
  output: string
  pages: number
  failures: PdfImagesFailure[]
}

/** pdf.worker 请求（node 侧已解析 ranges 之外的原始参数与输出目录） */
export interface PdfToImagesRequest {
  inputPath: string
  ranges: string
  format: OutputImageFormat
  dpi: Dpi
  outputDir: string
}

/** images.worker 请求（ffmpegPath 由 node 侧按 binaries 目录解析） */
export interface ImagesToPdfRequest {
  inputPaths: string[]
  pageSize: PageSizeMode
  orientation: PageOrientation
  marginMm: number
  /** 自定义输出文件名（不含扩展名亦可；缺省用首图基名模板） */
  outputName?: string
  outputDir: string
  ffmpegPath: string
}
