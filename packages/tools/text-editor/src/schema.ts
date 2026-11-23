/**
 * @file IPC 入参/出参 zod schema（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-22
 * @description open/save/save-as 的 payload 与结果形状（spec §3）。
 */
import { z } from 'zod'
import { TEXT_EDITOR_MAX_BYTES } from './formats'

/** 文件路径上限（Windows 长路径留足余量） */
const pathSchema = z.string().min(1).max(4096)

/** 正文长度上限（按字符；约 4 倍 5MiB 字节，覆盖多字节与后续编辑增长） */
const contentSchema = z.string().max(TEXT_EDITOR_MAX_BYTES * 4)

/** 文件名上限 */
const nameSchema = z.string().min(1).max(255)

/** 文本编码枚举（与 shared TextEncoding 同源） */
export const textEncodingSchema = z.enum(['utf8', 'utf8-bom', 'utf16le', 'utf16be', 'gbk'])
export type TextEncodingLabel = z.infer<typeof textEncodingSchema>

/** 换行符枚举（保存支持 LF / CRLF；CR 兼容读取结果） */
export const eolKindSchema = z.enum(['lf', 'crlf', 'cr'])
export type EolKindLabel = z.infer<typeof eolKindSchema>

// —— open（sync） ——

export const openPayloadSchema = z.object({ path: pathSchema })
export type OpenPayload = z.infer<typeof openPayloadSchema>

export const openResultSchema = z.object({
  path: pathSchema,
  name: nameSchema,
  size: z.number().int().min(0),
  mtimeMs: z.number().nonnegative(),
  content: z.string(),
  encoding: textEncodingSchema,
  eol: eolKindSchema,
  readOnly: z.boolean()
})
export type OpenResult = z.infer<typeof openResultSchema>

// —— save（sync） ——

export const savePayloadSchema = z.object({
  path: pathSchema,
  content: contentSchema,
  encoding: textEncodingSchema,
  eol: eolKindSchema,
  expectedMtimeMs: z.number().nonnegative().optional(),
  force: z.boolean().optional()
})
export type SavePayload = z.infer<typeof savePayloadSchema>

export const saveResultSchema = z.object({ mtimeMs: z.number().nonnegative() })
export type SaveResult = z.infer<typeof saveResultSchema>

// —— save-as（sync） ——

export const saveAsPayloadSchema = z.object({
  dir: pathSchema,
  name: nameSchema,
  content: contentSchema,
  encoding: textEncodingSchema,
  eol: eolKindSchema
})
export type SaveAsPayload = z.infer<typeof saveAsPayloadSchema>

export const saveAsResultSchema = z.object({
  path: pathSchema,
  mtimeMs: z.number().nonnegative()
})
export type SaveAsResult = z.infer<typeof saveAsResultSchema>
