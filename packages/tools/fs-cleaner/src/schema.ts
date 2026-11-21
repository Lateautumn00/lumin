/**
 * @file IPC 入参/出参 zod schema（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-21
 * @description config / set-config（同步）与 tree / empty-dirs / touch / temp-clean（任务）契约
 */
import { z } from 'zod'

/** 单次扫描条目上限（文件 + 目录） */
export const MAX_SCAN_FILES = 200_000

/** 进度推送节流步长 */
export const PROGRESS_STEP = 200

/** 目录树默认/允许深度 */
export const DEFAULT_TREE_DEPTH = 3
export const MIN_TREE_DEPTH = 1
export const MAX_TREE_DEPTH = 10

/** 临时文件默认扩展名规则 */
export const DEFAULT_TEMP_EXTENSIONS = ['tmp', 'temp', 'log', 'bak', 'old', 'cache']

/** 回收站单批上限（与壳 bridge 一致） */
export const TRASH_BATCH = 200

const EXCLUDE_ITEM = z.string().min(1).max(100)
const EXTENSION_ITEM = z.string().min(1).max(32)
const ROOT = z.string().min(1).max(32767)
const DEPTH = z.number().int().min(MIN_TREE_DEPTH).max(MAX_TREE_DEPTH)

export const configResultSchema = z.object({
  lastRoot: z.string().nullable(),
  treeDepth: DEPTH,
  treeExclude: z.array(EXCLUDE_ITEM).max(50),
  tempExtensions: z.array(EXTENSION_ITEM).max(50)
})

export type ConfigResult = z.infer<typeof configResultSchema>

export const setConfigPayloadSchema = z.object({
  /** 空串表示清空记忆目录（config 读回归一为 null） */
  lastRoot: z.string().max(32767).optional(),
  treeDepth: DEPTH,
  treeExclude: z.array(EXCLUDE_ITEM).max(50),
  tempExtensions: z.array(EXTENSION_ITEM).max(50)
})

export type SetConfigPayload = z.infer<typeof setConfigPayloadSchema>

// —— D3 目录树导出 ——

export const treePayloadSchema = z.object({
  root: ROOT,
  maxDepth: DEPTH,
  exclude: z.array(EXCLUDE_ITEM).max(50)
})

export type TreePayload = z.infer<typeof treePayloadSchema>

export const treeResultSchema = z.object({
  text: z.string(),
  dirs: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  truncated: z.boolean(),
  elapsedMs: z.number().nonnegative()
})

export type TreeResult = z.infer<typeof treeResultSchema>

// —— D4 空文件夹清理 ——

export const emptyDirsPayloadSchema = z.object({ root: ROOT })

export type EmptyDirsPayload = z.infer<typeof emptyDirsPayloadSchema>

export const emptyDirsResultSchema = z.object({
  dirs: z.array(z.string().min(1)),
  scannedDirs: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative()
})

export type EmptyDirsResult = z.infer<typeof emptyDirsResultSchema>

// —— D5 批量改文件时间 ——

export const touchPayloadSchema = z.object({
  root: ROOT,
  recursive: z.boolean(),
  extensions: z.array(EXTENSION_ITEM).max(50),
  /** 目标修改时间（epoch ms） */
  mtimeMs: z.number().int().min(0).max(4_102_444_800_000),
  /** true = 只预演不写盘 */
  dryRun: z.boolean()
})

export type TouchPayload = z.infer<typeof touchPayloadSchema>

export const touchFailureSchema = z.object({
  path: z.string().min(1),
  code: z.string().min(1),
  message: z.string()
})

export type TouchFailure = z.infer<typeof touchFailureSchema>

export const touchResultSchema = z.object({
  /** 命中文件总数（预演 = 应用时的目标数） */
  total: z.number().int().nonnegative(),
  /** 实际成功修改数（预演恒为 0） */
  updated: z.number().int().nonnegative(),
  /** 命中样例（预演展示用，最多 20 条） */
  sample: z.array(z.string().min(1)).max(20),
  failures: z.array(touchFailureSchema),
  elapsedMs: z.number().nonnegative()
})

export type TouchResult = z.infer<typeof touchResultSchema>

// —— D6 临时文件清理 ——

export const tempCleanPayloadSchema = z.object({
  root: ROOT,
  recursive: z.boolean(),
  extensions: z.array(EXTENSION_ITEM).min(1).max(50)
})

export type TempCleanPayload = z.infer<typeof tempCleanPayloadSchema>

export const tempFileSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().nonnegative()
})

export type TempFile = z.infer<typeof tempFileSchema>

export const tempCleanResultSchema = z.object({
  files: z.array(tempFileSchema),
  matchedBytes: z.number().int().nonnegative(),
  scannedFiles: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative()
})

export type TempCleanResult = z.infer<typeof tempCleanResultSchema>
