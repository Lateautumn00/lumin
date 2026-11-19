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
