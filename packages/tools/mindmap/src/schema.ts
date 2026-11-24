/**
 * @file 思维导图文档与 IPC 通道 zod schema
 * @author cuilanchao
 * @date 2026-11-24
 * @description 文档树、草稿文件、8 个 IPC 通道的入参与回包形状（spec §3.2、§5.1）。
 */
import { z } from 'zod'

import {
  COLOR_RE,
  ID_RE,
  MAX_BASE64_CHARS,
  MAX_DOC_BYTES,
  MAX_HYPERLINK,
  MAX_NOTE,
  MAX_PATH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_TOPIC,
  STYLE_VALUE_RE,
  type MindmapDocument,
  type MindmapNode
} from './contract'

/** 样式值 schema（长度 + 字符白名单） */
const styleValueSchema = z.string().min(1).max(64).regex(STYLE_VALUE_RE)

/** 节点样式（仅白名单键） */
export const mindmapStyleSchema = z
  .object({
    fontSize: styleValueSchema.optional(),
    fontFamily: styleValueSchema.optional(),
    color: styleValueSchema.optional(),
    background: styleValueSchema.optional(),
    fontWeight: styleValueSchema.optional(),
    width: styleValueSchema.optional(),
    border: styleValueSchema.optional(),
    textDecoration: styleValueSchema.optional()
  })
  .strict()

/** 布局方向 */
export const mindmapDirectionSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3)
])

/** 节点 schema（递归） */
export const mindmapNodeSchema: z.ZodType<MindmapNode> = z.lazy(() =>
  z
    .object({
      id: z.string().regex(ID_RE),
      topic: z.string().min(1).max(MAX_TOPIC),
      note: z.string().max(MAX_NOTE).optional(),
      hyperLink: z.string().max(MAX_HYPERLINK).optional(),
      expanded: z.boolean().optional(),
      direction: z.union([z.literal(0), z.literal(1)]).optional(),
      style: mindmapStyleSchema.optional(),
      tags: z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS).optional(),
      branchColor: z.string().regex(COLOR_RE).optional(),
      children: z.array(z.lazy(() => mindmapNodeSchema)).optional()
    })
    .strict()
)

/** 文档 schema */
export const mindmapDocumentSchema: z.ZodType<MindmapDocument> = z
  .object({
    nodeData: mindmapNodeSchema,
    arrows: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
    summaries: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
    direction: mindmapDirectionSchema.optional(),
    meta: z.record(z.string(), z.unknown()).optional()
  })
  .strict()

/** 原始 JSON 只要求 nodeData 是对象，细粒度清洗交给 sanitizeDocument */
export const rawDocumentSchema = z.object({ nodeData: z.record(z.string(), z.unknown()) }).loose()

/** 草稿文件（含保存时间与来源路径） */
export const draftFileSchema = z.object({
  savedAt: z.string().min(1).max(64),
  documentPath: z.string().min(1).max(MAX_PATH).optional(),
  data: mindmapDocumentSchema
})
export type DraftFile = z.infer<typeof draftFileSchema>

/** 文件路径 */
const pathSchema = z.string().min(1).max(MAX_PATH)

// —— 通道：open-dialog ——

export const openDialogResultSchema = z.union([z.object({ path: pathSchema }), z.null()])
export type OpenDialogResult = z.infer<typeof openDialogResultSchema>

// —— 通道：open-document ——

export const openDocumentPayloadSchema = z.object({ path: pathSchema })
export type OpenDocumentPayload = z.infer<typeof openDocumentPayloadSchema>

export const openDocumentResultSchema = z.object({
  path: pathSchema,
  name: z.string().min(1).max(255),
  data: z.unknown(),
  warnings: z.array(z.string()),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().nonnegative()
})
export type OpenDocumentResult = z.infer<typeof openDocumentResultSchema>

// —— 通道：save-document ——

export const saveDocumentPayloadSchema = z.object({
  path: pathSchema,
  data: mindmapDocumentSchema,
  expectedMtimeMs: z.number().nonnegative().optional(),
  force: z.boolean().optional()
})
export type SaveDocumentPayload = z.infer<typeof saveDocumentPayloadSchema>

export const saveDocumentResultSchema = z.object({
  path: pathSchema,
  mtimeMs: z.number().nonnegative(),
  warnings: z.array(z.string())
})
export type SaveDocumentResult = z.infer<typeof saveDocumentResultSchema>

// —— 通道：read-text-file ——

export const readTextFilePayloadSchema = z.object({ path: pathSchema })
export type ReadTextFilePayload = z.infer<typeof readTextFilePayloadSchema>

export const readTextFileResultSchema = z.object({
  text: z.string(),
  size: z.number().int().nonnegative(),
  name: z.string().min(1).max(255)
})
export type ReadTextFileResult = z.infer<typeof readTextFileResultSchema>

// —— 通道：write-export ——

const exportTextSchema = z.string().max(MAX_DOC_BYTES * 4)

export const writeExportPayloadSchema = z
  .object({
    path: pathSchema,
    text: exportTextSchema.optional(),
    base64: z.string().max(MAX_BASE64_CHARS).optional()
  })
  .refine((value) => (value.text === undefined) !== (value.base64 === undefined), {
    message: 'text 与 base64 必须二选一'
  })
export type WriteExportPayload = z.infer<typeof writeExportPayloadSchema>

export const writeExportResultSchema = z.object({
  path: pathSchema,
  size: z.number().int().nonnegative()
})
export type WriteExportResult = z.infer<typeof writeExportResultSchema>

// —— 通道：load-draft / save-draft / clear-draft ——

export const loadDraftPayloadSchema = z.object({})
export type LoadDraftPayload = z.infer<typeof loadDraftPayloadSchema>

export const loadDraftResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    data: mindmapDocumentSchema,
    savedAt: z.string().min(1).max(64),
    documentPath: z.string().min(1).max(MAX_PATH).optional()
  }),
  z.object({ status: z.literal('empty') }),
  z.object({ status: z.literal('corrupt') })
])
export type LoadDraftResult = z.infer<typeof loadDraftResultSchema>

export const saveDraftPayloadSchema = z.object({
  data: mindmapDocumentSchema,
  documentPath: pathSchema.optional()
})
export type SaveDraftPayload = z.infer<typeof saveDraftPayloadSchema>

export const saveDraftResultSchema = z.object({ savedAt: z.string().min(1).max(64) })
export type SaveDraftResult = z.infer<typeof saveDraftResultSchema>

export const clearDraftResultSchema = z.object({})
export type ClearDraftResult = z.infer<typeof clearDraftResultSchema>
