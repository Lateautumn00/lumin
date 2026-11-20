/**
 * @file IPC 入参/出参 zod schema（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-20
 * @description config / set-config（同步）与 pack / unpack（任务）的契约与常量（spec §5）
 */
import { z } from 'zod'

/** 单次打包源上限 */
export const MAX_SOURCES = 200

/** 单次打包/解压条目上限 */
export const MAX_ENTRIES = 100_000

/** 解压累计原始大小上限（10 GiB，防压缩炸弹） */
export const MAX_UNPACK_BYTES = 10 * 1024 ** 3

/** 进度推送的最小条目间隔 */
export const PROGRESS_STEP_ENTRIES = 20

/** 默认同名冲突策略 */
export const DEFAULT_CONFLICT = 'rename'

/** 模式 Tab */
export const modeSchema = z.enum(['pack', 'unpack'])
export type Mode = z.infer<typeof modeSchema>

/** 解压同名冲突策略：自动重命名 / 跳过 */
export const conflictPolicySchema = z.enum(['rename', 'skip'])
export type ConflictPolicy = z.infer<typeof conflictPolicySchema>

/** 输出文件名不得含路径分隔符（目录与文件名分离提交） */
const outputNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !/[\\/]/.test(value), '文件名不能包含路径分隔符')

export const packPayloadSchema = z.object({
  sources: z.array(z.string().min(1).max(32767)).min(1).max(MAX_SOURCES),
  outputDir: z.string().min(1).max(32767),
  outputName: outputNameSchema
})

export type PackPayload = z.infer<typeof packPayloadSchema>
/** worker 请求与 payload 同形 */
export type PackRequest = PackPayload

export const unpackPayloadSchema = z.object({
  archive: z.string().min(1).max(32767),
  targetDir: z.string().min(1).max(32767),
  conflict: conflictPolicySchema
})

export type UnpackPayload = z.infer<typeof unpackPayloadSchema>
/** worker 请求与 payload 同形 */
export type UnpackRequest = UnpackPayload

export const packDoneSchema = z.object({
  outputZip: z.string().min(1),
  files: z.number().int().nonnegative(),
  dirs: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative()
})

export type PackResult = z.infer<typeof packDoneSchema>

export const unpackDoneSchema = z.object({
  targetDir: z.string().min(1),
  files: z.number().int().nonnegative(),
  dirs: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  renamed: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative()
})

export type UnpackResult = z.infer<typeof unpackDoneSchema>

export const configResultSchema = z.object({
  mode: modeSchema,
  packSources: z.array(z.string()),
  outputDir: z.string().nullable(),
  outputName: z.string().nullable(),
  archive: z.string().nullable(),
  targetDir: z.string().nullable(),
  conflict: conflictPolicySchema
})

export type ConfigResult = z.infer<typeof configResultSchema>

export const setConfigPayloadSchema = z.object({
  mode: modeSchema,
  packSources: z.array(z.string().max(32767)).max(MAX_SOURCES),
  outputDir: z.string().max(32767).nullable(),
  outputName: z.string().max(255).nullable(),
  archive: z.string().max(32767).nullable(),
  targetDir: z.string().max(32767).nullable(),
  conflict: conflictPolicySchema
})

export type SetConfigPayload = z.infer<typeof setConfigPayloadSchema>

/** worker 请求：模式 + 对应 payload（单一 worker 文件按 mode 分派） */
export type ArchiveRequest =
  | { mode: 'pack'; payload: PackRequest }
  | { mode: 'unpack'; payload: UnpackRequest }

/** worker 结果 */
export type ArchiveResult = PackResult | UnpackResult
