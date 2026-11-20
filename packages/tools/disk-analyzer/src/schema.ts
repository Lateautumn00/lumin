/**
 * @file IPC 入参/出参 zod schema（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-20
 * @description config / set-config（同步）与 scan（任务）的契约与常量（spec §5）
 */
import { z } from 'zod'

/** 最小文件显示阈值预设（字节；UI 展示 0 / 1KB / 100KB / 1MB） */
export const MIN_FILE_BYTES_OPTIONS = [0, 1024, 100 * 1024, 1024 ** 2] as const

/** 默认最小文件显示阈值（不过滤） */
export const DEFAULT_MIN_FILE_BYTES = 0

/** 单次扫描普通文件数上限 */
export const MAX_SCAN_FILES = 200_000

/** 单层最多展示条数（其余折叠） */
export const MAX_VISIBLE_ENTRIES = 100

export const scanPayloadSchema = z.object({
  root: z.string().min(1).max(32767),
  minFileBytes: z.number().int().min(0).max(1024 ** 4)
})

export type ScanPayload = z.infer<typeof scanPayloadSchema>
/** worker 请求与 payload 同形 */
export type ScanRequest = ScanPayload

/** 当前层的单个直接子项（目录含后代汇总） */
export const diskEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['dir', 'file']),
  size: z.number().int().nonnegative(),
  /** 目录：后代文件数；文件：0 */
  fileCount: z.number().int().nonnegative()
})

export type DiskEntry = z.infer<typeof diskEntrySchema>
export type EntryKind = DiskEntry['kind']

export const scanDoneSchema = z.object({
  root: z.string().min(1),
  entries: z.array(diskEntrySchema),
  totalBytes: z.number().int().nonnegative(),
  /** 本次扫描成功测量的普通文件总数（递归） */
  fileCount: z.number().int().nonnegative(),
  /** 本次扫描访问的子目录总数（不含 root） */
  dirCount: z.number().int().nonnegative(),
  /** stat/读取失败被跳过（文件或子目录）数 */
  skipped: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative()
})

export type ScanResult = z.infer<typeof scanDoneSchema>

export const configResultSchema = z.object({
  root: z.string().nullable(),
  minFileBytes: z.number().int().nonnegative()
})

export type ConfigResult = z.infer<typeof configResultSchema>

export const setConfigPayloadSchema = z.object({
  /** 空串表示清空记忆目录（config 读回归一为 null） */
  root: z.string().max(32767).optional(),
  minFileBytes: z.number().int().min(0).max(1024 ** 4)
})

export type SetConfigPayload = z.infer<typeof setConfigPayloadSchema>
