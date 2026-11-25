/**
 * @file IPC 入参/出参 zod schema（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-24
 * @description config/set-output-dir/save/open-file/save-file 通道 payload 与结果形状（spec §3.5 / §5）
 */
import { z } from 'zod'
import { EXTENSIONS } from './save'

/** 单次导出内容上限（字符，约 8MB） */
export const MAX_SAVE_CONTENT_CHARS = 8_000_000

/** 打开已有 Markdown 文档的字节上限（5 MiB） */
export const MAX_MD_FILE_BYTES = 5 * 1024 * 1024

/** 文件路径上限（Windows 长路径留足余量） */
const pathSchema = z.string().min(1).max(4096)

/** 扩展名枚举（单一来源 save.ts） */
export const saveExtensionSchema = z.enum(EXTENSIONS)

// —— config（sync） ——

export const configResultSchema = z.object({ outputDir: z.string().min(1) })
export type ConfigResult = z.infer<typeof configResultSchema>

// —— set-output-dir（sync，输出目录记忆） ——

export const setOutputDirPayloadSchema = z.object({ outputDir: z.string().min(1).max(4096) })
export type SetOutputDirPayload = z.infer<typeof setOutputDirPayloadSchema>

// —— save（sync，原子写盘） ——

export const savePayloadSchema = z.object({
  outputDir: z.string().min(1).max(4096),
  baseName: z.string().min(1).max(80),
  extension: saveExtensionSchema,
  content: z.string().min(1).max(MAX_SAVE_CONTENT_CHARS)
})
export type SavePayload = z.infer<typeof savePayloadSchema>

export const saveResultSchema = z.object({ output: z.string().min(1).max(4096) })
export type SaveResult = z.infer<typeof saveResultSchema>

// —— open-file（sync，打开已有 Markdown 文档） ——

export const openFilePayloadSchema = z.object({ path: pathSchema.optional() })
export type OpenFilePayload = z.infer<typeof openFilePayloadSchema>

export const openFileResultSchema = z.object({
  path: pathSchema,
  name: z.string().min(1).max(255),
  content: z.string().max(MAX_SAVE_CONTENT_CHARS),
  size: z.number().int().min(0),
  mtimeMs: z.number().nonnegative()
})
export type OpenFileResult = z.infer<typeof openFileResultSchema>

// —— save-file（sync，覆盖原文件 / 另存为落盘） ——

export const saveFilePayloadSchema = z.object({
  path: pathSchema,
  content: z.string().max(MAX_SAVE_CONTENT_CHARS),
  expectedMtimeMs: z.number().nonnegative().optional(),
  force: z.boolean().optional()
})
export type SaveFilePayload = z.infer<typeof saveFilePayloadSchema>

export const saveFileResultSchema = z.object({
  path: pathSchema,
  mtimeMs: z.number().nonnegative()
})
export type SaveFileResult = z.infer<typeof saveFileResultSchema>
