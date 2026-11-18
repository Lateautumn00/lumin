/**
 * @file IPC 入参/出参 zod schema（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-18
 * @description scan/apply/undo/config/set-dir 五通道的 payload 与结果形状（spec §5）
 */
import { z } from 'zod'

/** 单次扫描文件数上限（超限截断，spec §5） */
export const SCAN_LIMIT = 5000

// —— scan（sync） ——

export const scanPayloadSchema = z.object({ dir: z.string().min(1) })
export type ScanPayload = z.infer<typeof scanPayloadSchema>

/** 目录内单个普通文件（size/mtime 供列表展示） */
export const scanFileSchema = z.object({
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().nonnegative()
})

export const scanResultSchema = z.object({
  files: z.array(scanFileSchema),
  /** 文件数超过 SCAN_LIMIT 被截断 */
  truncated: z.boolean()
})

export type ScanFile = z.infer<typeof scanFileSchema>
export type ScanResult = z.infer<typeof scanResultSchema>

// —— apply / undo（task） ——

/** 单条改名（from/to 均为文件名，不含目录） */
export const renamePairSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1)
})

export const renamePairsSchema = z.array(renamePairSchema).min(1).max(SCAN_LIMIT)

/** apply：把 from 改名为 to；undo：from=当前名、to=原名（同一算法） */
export const applyPayloadSchema = z.object({
  dir: z.string().min(1),
  pairs: renamePairsSchema
})

export type RenamePair = z.infer<typeof renamePairSchema>
export type ApplyPayload = z.infer<typeof applyPayloadSchema>

/** 单条失败（批量语义：失败不中断批次） */
export const renameFailureSchema = z.object({
  from: z.string(),
  code: z.string(),
  message: z.string()
})

export const renameTaskResultSchema = z.object({
  renamed: z.array(renamePairSchema),
  failures: z.array(renameFailureSchema)
})

export type RenameFailure = z.infer<typeof renameFailureSchema>
export type RenameTaskResult = z.infer<typeof renameTaskResultSchema>

// —— config / set-dir（sync） ——

export const configResultSchema = z.object({ lastDir: z.string().nullable() })
export type ConfigResult = z.infer<typeof configResultSchema>

export const setDirPayloadSchema = z.object({ dir: z.string().min(1) })
export type SetDirPayload = z.infer<typeof setDirPayloadSchema>
