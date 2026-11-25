/**
 * @file IPC 入参/出参 zod schema（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-19
 * @description config / set-config（同步）与 scan（任务）的契约与常量（spec §4）
 */
import { z } from 'zod'

/** 最小文件大小预设（字节；UI 展示 1KB/100KB/1MB/10MB） */
export const MIN_BYTES_OPTIONS = [1024, 100 * 1024, 1024 ** 2, 10 * 1024 ** 2] as const

/** 默认最小文件大小（1 MB） */
export const DEFAULT_MIN_BYTES = 1024 ** 2

/** 默认包含子目录 */
export const DEFAULT_RECURSIVE = true

/** 单次扫描文件数上限 */
export const MAX_SCAN_FILES = 200_000

/** 预筛哈希读取的前缀字节数（≤ 该值的文件前缀哈希即最终哈希） */
export const PARTIAL_BYTES = 64 * 1024

export const scanPayloadSchema = z.object({
  root: z.string().min(1).max(32767),
  recursive: z.boolean(),
  minBytes: z.number().int().min(0).max(1024 ** 4)
})

export type ScanPayload = z.infer<typeof scanPayloadSchema>
/** worker 请求与 payload 同形 */
export type ScanRequest = ScanPayload

/** 重复组内的单个文件 */
export const duplicateFileSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().nonnegative()
})

export type DuplicateFile = z.infer<typeof duplicateFileSchema>

/** 内容完全相同的一组文件（至少 2 项） */
export const duplicateGroupSchema = z.object({
  size: z.number().int().nonnegative(),
  /** 完整 SHA-256 */
  hash: z.string().min(1),
  files: z.array(duplicateFileSchema).min(2),
  /** 可释放空间 = size × (files.length - 1) */
  wastedBytes: z.number().int().nonnegative()
})

export type DuplicateGroup = z.infer<typeof duplicateGroupSchema>

export const scanDoneSchema = z.object({
  groups: z.array(duplicateGroupSchema),
  /** 实际检查过的普通文件数（含小于阈值的） */
  scannedFiles: z.number().int().nonnegative(),
  /** stat/读取失败被跳过（文件或子目录）数 */
  skipped: z.number().int().nonnegative(),
  totalWastedBytes: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative()
})

export type ScanResult = z.infer<typeof scanDoneSchema>

export const configResultSchema = z.object({
  root: z.string().nullable(),
  recursive: z.boolean(),
  minBytes: z.number().int().nonnegative()
})

export type ConfigResult = z.infer<typeof configResultSchema>

export const setConfigPayloadSchema = z.object({
  /** 空串表示清空记忆目录（config 读回归一为 null） */
  root: z.string().max(32767).optional(),
  recursive: z.boolean(),
  minBytes: z.number().int().min(0).max(1024 ** 4)
})

export type SetConfigPayload = z.infer<typeof setConfigPayloadSchema>
