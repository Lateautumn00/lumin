/**
 * @file IPC 入参/出参 zod schema（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-21
 * @description config/set-output-dir/save 三通道 payload 与结果形状（spec §3.5 / §5）
 */
import { z } from 'zod'
import { EXTENSIONS } from './save'

/** 单次导出内容上限（字符，约 8MB） */
export const MAX_SAVE_CONTENT_CHARS = 8_000_000

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
