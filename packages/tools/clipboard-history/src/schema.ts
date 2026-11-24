/**
 * @file IPC schema 单源（AGENTS §6：IPC schema 归工具包，Zod 双侧校验）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 7 同步通道 list/poll/pin/remove/clear/image/copy 的载荷与回包 schema；
 *              Entry 形状（M61 扩展 type 与图片字段，旧 JSON 无 type 默认 text）、
 *              上限常量（文本 500 条 / 100KB、图片 100 条 / 5MB、缩略图 160px、搜索 64 字符）
 *              与 spec §1/§2 一致。
 */
import { z } from 'zod'

/** 历史条目上限（超过从尾部最旧未置顶逐条淘汰，置顶永不淘汰） */
export const MAX_ENTRIES = 500
/** 单条文本上限（UTF-8 字节；超限跳过并提示） */
export const MAX_TEXT_BYTES = 100 * 1024
/** 图片条目独立上限（与文本 500 独立计数，超出淘汰最旧未置顶图片） */
export const MAX_IMAGE_ENTRIES = 100
/** 单张图片上限（PNG 字节；超限跳过并提示） */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** 缩略图目标宽度（px，≤160 宽 PNG dataURL 内联 JSON） */
export const THUMB_WIDTH = 160
/** 搜索词上限（字符） */
export const MAX_QUERY_LENGTH = 64

/** 历史条目（字段与 spec §2 一致：图片附加 width/height/bytes/sha1/thumb，text 恒空串） */
export const entrySchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  createdAt: z.number().int().nonnegative(),
  pinned: z.boolean(),
  /** M59 旧条目无 type 字段 → 默认按文本加载（向后兼容） */
  type: z.enum(['text', 'image']).default('text'),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  bytes: z.number().int().nonnegative().optional(),
  sha1: z.string().optional(),
  thumb: z.string().optional()
})
export type Entry = z.infer<typeof entrySchema>

/** 持久化文件内容（文本 500 + 图片 100 = 600 条上限，超出视为损坏重建） */
export const entriesFileSchema = z.array(entrySchema).max(MAX_ENTRIES + MAX_IMAGE_ENTRIES)

/** 空入参载荷（list / poll / clear） */
export const emptyPayloadSchema = z.object({})

/** 带 id 载荷（pin / remove / image / copy） */
export const idPayloadSchema = z.object({ id: z.string().min(1) })

/** list 回包：全量（置顶前、组内 createdAt 倒序） */
export const listResultSchema = z.object({ items: z.array(entrySchema) })
export type ListResult = z.infer<typeof listResultSchema>

/** poll 回包：命中返回条目（新条目 / 去重前移），超限返回 skipped */
export const pollResultSchema = z.object({
  entry: entrySchema.nullable(),
  skipped: z.literal('TOO_LARGE').optional()
})
export type PollResult = z.infer<typeof pollResultSchema>

/** pin / remove / clear / copy 回包 */
export const okResultSchema = z.object({ ok: z.literal(true) })
export type OkResult = z.infer<typeof okResultSchema>

/** image 回包：原图 data:image/png;base64,… */
export const imageResultSchema = z.object({ dataUrl: z.string().min(1) })
export type ImageResult = z.infer<typeof imageResultSchema>
