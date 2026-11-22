/**
 * @file IPC 入参/出参 zod schema（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-19
 * @description hash / config / set-config 三通道的 payload 与结果形状（spec §4）
 */
import { z } from 'zod'

/** 支持的摘要算法（顺序即 UI 展示顺序） */
export const ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha512'] as const

export type Algorithm = (typeof ALGORITHMS)[number]

/** 默认勾选算法（spec §2：默认只算 SHA-256） */
export const DEFAULT_ALGORITHMS: readonly Algorithm[] = ['sha256']

/** 单次任务文件数上限 */
export const MAX_FILES = 200

/** 单文件体积上限（20 GB；超过记入失败不读取） */
export const MAX_FILE_BYTES = 20 * 1024 ** 3

export const algorithmSchema = z.enum(ALGORITHMS)

// —— hash（task） ——

export const hashPayloadSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(MAX_FILES),
  algorithms: z.array(algorithmSchema).min(1).max(ALGORITHMS.length)
})

export type HashPayload = z.infer<typeof hashPayloadSchema>
/** worker 请求与 payload 同形 */
export type HashRequest = HashPayload

/** 单文件结果（失败项 hashes 为空，code 见 errors.ts） */
export const hashFileResultSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().nonnegative(),
  hashes: z.object({
    md5: z.string().optional(),
    sha1: z.string().optional(),
    sha256: z.string().optional(),
    sha512: z.string().optional()
  }),
  status: z.enum(['ok', 'failed']),
  code: z.string().optional(),
  /** 失败细节（errno/中文说明），成功时缺省 */
  message: z.string().optional()
})

export type HashFileResult = z.infer<typeof hashFileResultSchema>

export const hashDoneSchema = z.object({
  results: z.array(hashFileResultSchema),
  failedCount: z.number().int().nonnegative(),
  /** 参与计算的字节总数（不含准备阶段失败项） */
  totalBytes: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative()
})

export type HashResult = z.infer<typeof hashDoneSchema>

// —— config / set-config（sync） ——

export const configResultSchema = z.object({
  algorithms: z.array(algorithmSchema).min(1).max(ALGORITHMS.length)
})

export type ConfigResult = z.infer<typeof configResultSchema>

export const setConfigPayloadSchema = z.object({
  algorithms: z.array(algorithmSchema).min(1).max(ALGORITHMS.length)
})

export type SetConfigPayload = z.infer<typeof setConfigPayloadSchema>
