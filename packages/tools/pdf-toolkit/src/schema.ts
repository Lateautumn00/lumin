/**
 * @file schema.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description pdf-toolkit IPC 入参 zod 契约与回包/进度类型（字段级清单见 docs/spec/pdf-toolkit.md §5）
 */
import { z } from 'zod'

/** PDF 输入白名单（大小写不敏感） */
export const PDF_INPUT_RE = /\.pdf$/i

/** 合并单次最多文件数 */
export const MAX_MERGE_FILES = 100

/** 页码范围语法（仅数字/逗号/连字符/空白；语义校验在 shared/ranges） */
export const RANGE_RE = /^[\d\s,-]+$/

/** 页码文本最大长度（防超长 payload） */
export const MAX_RANGE_LEN = 2000

/** 元数据单字段最大长度 */
export const MAX_METADATA_LEN = 500

/** 重排页数上限（防御超长数组） */
export const MAX_ORDER_PAGES = 10_000

const pdfPathSchema = z.string().min(1).regex(PDF_INPUT_RE, '仅支持 PDF 文件')

const rangeSchema = z
  .string()
  .min(1, '页码范围不能为空')
  .max(MAX_RANGE_LEN, '页码范围过长')
  .regex(RANGE_RE, '页码范围仅含数字、逗号与连字符')

export const infoPayloadSchema = z.object({ inputPath: pdfPathSchema })
export type InfoPayload = z.infer<typeof infoPayloadSchema>

export const mergePayloadSchema = z.object({
  inputPaths: z
    .array(pdfPathSchema)
    .min(2, '至少选择 2 个 PDF')
    .max(MAX_MERGE_FILES, `单次最多 ${MAX_MERGE_FILES} 个文件`)
})
export type MergePayload = z.infer<typeof mergePayloadSchema>

export const splitPayloadSchema = z.object({
  inputPath: pdfPathSchema,
  ranges: rangeSchema
})
export type SplitPayload = z.infer<typeof splitPayloadSchema>

export const deletePayloadSchema = z.object({
  inputPath: pdfPathSchema,
  ranges: rangeSchema
})
export type DeletePayload = z.infer<typeof deletePayloadSchema>

export const rotatePayloadSchema = z.object({
  inputPath: pdfPathSchema,
  /** 空/缺省 = 全部页 */
  ranges: z
    .string()
    .max(MAX_RANGE_LEN, '页码范围过长')
    .regex(/^[\d\s,-]*$/, '页码范围仅含数字、逗号与连字符')
    .optional(),
  degrees: z.union([z.literal(90), z.literal(180), z.literal(270)])
})
export type RotatePayload = z.infer<typeof rotatePayloadSchema>

export const reorderPayloadSchema = z.object({
  inputPath: pdfPathSchema,
  /** 1-based 页序；必须是 1..N 全排列（由 pdf-ops 按实际页数校验） */
  order: z
    .array(z.number().int().min(1).max(MAX_ORDER_PAGES))
    .min(1, '页面顺序不能为空')
    .max(MAX_ORDER_PAGES, '页数过多')
})
export type ReorderPayload = z.infer<typeof reorderPayloadSchema>

const metaField = z.string().max(MAX_METADATA_LEN, `单字段最多 ${MAX_METADATA_LEN} 字符`)

/** 元数据补丁：空字符串 = 保持原值；至少一项非空 */
export const metadataPatchSchema = z
  .object({
    title: metaField.optional(),
    author: metaField.optional(),
    subject: metaField.optional(),
    keywords: metaField.optional()
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined && value.trim() !== ''),
    {
      message: '至少填写一项元数据'
    }
  )

export type MetadataPatch = z.infer<typeof metadataPatchSchema>

export const metadataPayloadSchema = z.object({
  inputPath: pdfPathSchema,
  metadata: metadataPatchSchema
})
export type MetadataPayload = z.infer<typeof metadataPayloadSchema>

/** 水印文字最大长度（renderer 栅格化前校验） */
export const MAX_WATERMARK_TEXT = 200

/** 栅格化 PNG base64 最大长度（≈3MB 图片，防超长 payload） */
export const MAX_WATERMARK_IMAGE_CHARS = 4_000_000

/** 水印图片来源白名单 */
export const WATERMARK_IMAGE_RE = /\.(png|jpe?g)$/i

/** 16 进制颜色（#rrggbb） */
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** 页码模板最大长度 */
export const MAX_PAGE_NUMBER_FORMAT = 100

/** 页码模板仅允许 ASCII 可打印字符（标准字体 Helvetica 限制） */
export const PAGE_NUMBER_FORMAT_RE = /^[\x20-\x7e]+$/

/** 页码位置枚举 */
export const PAGE_NUMBER_POSITIONS = [
  'bottom-center',
  'bottom-right',
  'bottom-left',
  'top-center',
  'top-right',
  'top-left'
] as const

export type PageNumberPosition = (typeof PAGE_NUMBER_POSITIONS)[number]

const base64PngSchema = z
  .string()
  .min(1, '水印图片不能为空')
  .max(MAX_WATERMARK_IMAGE_CHARS, '水印图片过大')

const optionalRangesSchema = z
  .string()
  .max(MAX_RANGE_LEN, '页码范围过长')
  .regex(/^[\d\s,-]*$/, '页码范围仅含数字、逗号与连字符')
  .optional()

const watermarkCommon = {
  inputPath: pdfPathSchema,
  /** 透明度 0.05–1 */
  opacity: z.number().min(0.05, '透明度至少 5%').max(1),
  /** 旋转角度 -90–90（度） */
  angle: z.number().int().min(-90).max(90),
  /** 水印宽度占页宽百分比 5–50 */
  scale: z.number().int().min(5).max(50),
  /** 是否平铺 */
  tile: z.boolean(),
  ranges: optionalRangesSchema
}

/** 水印：文字（renderer 预栅格化 PNG）或图片（本地 PNG/JPG 路径） */
export const watermarkPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    /** 栅格化透明 PNG（base64，不含 data: 前缀） */
    imageData: base64PngSchema,
    ...watermarkCommon
  }),
  z.object({
    kind: z.literal('image'),
    imagePath: z.string().min(1).regex(WATERMARK_IMAGE_RE, '仅支持 PNG/JPG 图片'),
    ...watermarkCommon
  })
])
export type WatermarkPayload = z.infer<typeof watermarkPayloadSchema>

/** 页码 */
export const pageNumberPayloadSchema = z.object({
  inputPath: pdfPathSchema,
  format: z
    .string()
    .min(1, '页码格式不能为空')
    .max(MAX_PAGE_NUMBER_FORMAT, '页码格式过长')
    .regex(PAGE_NUMBER_FORMAT_RE, '页码格式仅支持英文/数字/符号')
    .refine((value) => value.includes('{n}'), '页码格式必须包含 {n}'),
  position: z.enum(PAGE_NUMBER_POSITIONS),
  /** 从第几页开始加页码（此后页码从 1 起） */
  startPage: z.number().int().min(1).max(MAX_ORDER_PAGES),
  fontSize: z.number().int().min(8).max(32),
  color: z.string().regex(HEX_COLOR_RE, '颜色格式应为 #rrggbb'),
  /** 边距（pt） */
  margin: z.number().int().min(12).max(72),
  ranges: optionalRangesSchema
})
export type PageNumberPayload = z.infer<typeof pageNumberPayloadSchema>

/** PDF 元数据快照（缺省字段归一为空串） */
export interface PdfMetadata {
  title: string
  author: string
  subject: string
  keywords: string
  creator: string
  producer: string
}

/** `pdf-toolkit:info` 返回 */
export interface InfoResult {
  pageCount: number
  fileName: string
  metadata: PdfMetadata
}

/** 任务 done 回包（恒为绝对路径列表） */
export interface OpResult {
  outputPaths: string[]
}

/** worker 进度（外壳补 taskId 后推送） */
export interface PdfProgress {
  stage: 'load' | 'process' | 'write' | 'done'
  current: number
  total?: number
  message?: string
}
