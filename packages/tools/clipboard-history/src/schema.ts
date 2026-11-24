/**
 * @file IPC schema 单源（AGENTS §6：IPC schema 归工具包，Zod 双侧校验）
 * @author cuilanchao
 * @date 2026-11-23
 * @description 5 同步通道 list/poll/pin/remove/clear 的载荷与回包 schema；
 *              Entry 形状与上限常量（500 条 / 100KB / 搜索 64 字符）与 spec §1 一致。
 */
import { z } from 'zod'

/** 历史条目上限（超过从尾部最旧未置顶逐条淘汰，置顶永不淘汰） */
export const MAX_ENTRIES = 500
/** 单条文本上限（UTF-8 字节；超限跳过并提示） */
export const MAX_TEXT_BYTES = 100 * 1024
/** 搜索词上限（字符） */
export const MAX_QUERY_LENGTH = 64

/** 历史条目（字段与 spec §1.1 一致） */
export const entrySchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  createdAt: z.number().int().nonnegative(),
  pinned: z.boolean()
})
export type Entry = z.infer<typeof entrySchema>

/** 持久化文件内容（数组上限 = MAX_ENTRIES，超出视为损坏重建） */
export const entriesFileSchema = z.array(entrySchema).max(MAX_ENTRIES)

/** 空入参载荷（list / poll / clear） */
export const emptyPayloadSchema = z.object({})

/** 带 id 载荷（pin / remove） */
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

/** pin / remove / clear 回包 */
export const okResultSchema = z.object({ ok: z.literal(true) })
export type OkResult = z.infer<typeof okResultSchema>
