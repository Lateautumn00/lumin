/**
 * @file IPC 入参/出参 zod schema（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-22
 * @description inspect/read-text/asset-url/convert-office/render-pdf-page/release-preview/
 *              soffice-status/set-soffice-path 的 payload 与结果形状（spec §3）。
 */
import { z } from 'zod'
import { PREVIEW_KINDS } from './formats'

/** 文本预览读取上限（字节，spec §2：2MiB 截断） */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024

/** PDF 页缩放范围（DPI/72 倍率） */
export const MIN_PAGE_SCALE = 0.5
export const MAX_PAGE_SCALE = 4
export const DEFAULT_PAGE_SCALE = 1.5

/** 文件路径上限（Windows 长路径留足余量） */
const pathSchema = z.string().min(1).max(4096)

/** 预览类型枚举（结果不返回 unsupported：不支持直接报错） */
const previewKindSchema = z.enum(PREVIEW_KINDS)

// —— inspect（sync） ——

export const inspectPayloadSchema = z.object({ path: pathSchema })
export type InspectPayload = z.infer<typeof inspectPayloadSchema>

export const inspectResultSchema = z.object({
  previewId: z.string().min(1),
  kind: previewKindSchema,
  ext: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().min(0),
  pageCount: z.number().int().positive().optional()
})
export type InspectResult = z.infer<typeof inspectResultSchema>

// —— read-text（sync） ——

export const readTextPayloadSchema = z.object({
  path: pathSchema,
  maxBytes: z.number().int().min(1).max(MAX_TEXT_BYTES).optional()
})
export type ReadTextPayload = z.infer<typeof readTextPayloadSchema>

export const textEncodingSchema = z.enum(['utf8', 'utf8-bom', 'utf16le', 'utf16be', 'gbk'])
export type TextEncodingLabel = z.infer<typeof textEncodingSchema>

export const eolSchema = z.enum(['\n', '\r\n', '\r'])
export type EolLabel = z.infer<typeof eolSchema>

export const readTextResultSchema = z.object({
  text: z.string(),
  encoding: textEncodingSchema,
  eol: eolSchema,
  truncated: z.boolean()
})
export type ReadTextResult = z.infer<typeof readTextResultSchema>

// —— asset-url（sync，仅图片） ——

export const assetUrlPayloadSchema = z.object({ path: pathSchema })
export type AssetUrlPayload = z.infer<typeof assetUrlPayloadSchema>

export const assetUrlResultSchema = z.object({ url: z.string().min(1) })
export type AssetUrlResult = z.infer<typeof assetUrlResultSchema>

// —— convert-office（task，可取消） ——

export const convertOfficePayloadSchema = z.object({ path: pathSchema })
export type ConvertOfficePayload = z.infer<typeof convertOfficePayloadSchema>

export const convertOfficeResultSchema = z.object({
  previewId: z.string().min(1),
  pageCount: z.number().int().positive()
})
export type ConvertOfficeResult = z.infer<typeof convertOfficeResultSchema>

// —— render-pdf-page（sync） ——

export const renderPdfPagePayloadSchema = z.object({
  previewId: z.string().min(1),
  page: z.number().int().min(1).max(100_000),
  scale: z.number().min(MIN_PAGE_SCALE).max(MAX_PAGE_SCALE).optional()
})
export type RenderPdfPagePayload = z.infer<typeof renderPdfPagePayloadSchema>

export const renderPdfPageResultSchema = z.object({
  /** PNG 字节的 base64（跨 IPC 传输） */
  png: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive()
})
export type RenderPdfPageResult = z.infer<typeof renderPdfPageResultSchema>

// —— release-preview（sync） ——

export const releasePreviewPayloadSchema = z.object({ previewId: z.string().min(1) })
export type ReleasePreviewPayload = z.infer<typeof releasePreviewPayloadSchema>

export const releasePreviewResultSchema = z.object({ released: z.boolean() })
export type ReleasePreviewResult = z.infer<typeof releasePreviewResultSchema>

// —— soffice-status / set-soffice-path（sync） ——

export const sofficeStatusResultSchema = z.object({
  found: z.boolean(),
  path: z.string().min(1).max(4096).optional()
})
export type SofficeStatusResult = z.infer<typeof sofficeStatusResultSchema>

/** 空字符串表示清除自定义路径（回退系统/便携检测） */
export const setSofficePathPayloadSchema = z.object({ path: z.string().max(4096) })
export type SetSofficePathPayload = z.infer<typeof setSofficePathPayloadSchema>
