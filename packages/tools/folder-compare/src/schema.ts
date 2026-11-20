/**
 * @file IPC 入参/出参 zod schema（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-20
 * @description config / set-config（同步）与 compare（任务）的契约与常量（spec §5）
 */
import { z } from 'zod'

/** 修改时间比较容差（毫秒；文件系统精度差异不视为差异） */
export const MTIME_TOLERANCE_MS = 2_000

/** 单侧普通文件数上限 */
export const MAX_FILES_PER_SIDE = 200_000

/** worker 返回结果条目上限（超出部分只计数不返回） */
export const MAX_RESULT_ENTRIES = 20_000

/** 单页最多展示条数（其余折叠） */
export const MAX_VISIBLE_ENTRIES = 500

/** 默认比较修改时间 */
export const DEFAULT_COMPARE_MTIME = true

export const comparePayloadSchema = z.object({
  leftRoot: z.string().min(1).max(32767),
  rightRoot: z.string().min(1).max(32767),
  compareMtime: z.boolean()
})

export type ComparePayload = z.infer<typeof comparePayloadSchema>
/** worker 请求与 payload 同形 */
export type CompareRequest = ComparePayload

/** 配对状态：仅左侧 / 仅右侧 / 有差异 / 元数据相同 */
export const diffStatusSchema = z.enum(['only-left', 'only-right', 'different', 'same'])

export type DiffStatus = z.infer<typeof diffStatusSchema>

/** 单条配对结果（缺失侧的大小/时间为 null） */
export const compareEntrySchema = z.object({
  /** 相对路径（`/` 分隔，展示保留原样大小写） */
  path: z.string().min(1),
  status: diffStatusSchema,
  sizeLeft: z.number().int().nonnegative().nullable(),
  sizeRight: z.number().int().nonnegative().nullable(),
  mtimeLeft: z.number().nonnegative().nullable(),
  mtimeRight: z.number().nonnegative().nullable(),
  /** status 为 different 时有意义 */
  sizeChanged: z.boolean(),
  mtimeChanged: z.boolean()
})

export type CompareEntry = z.infer<typeof compareEntrySchema>

export const compareDoneSchema = z.object({
  leftRoot: z.string().min(1),
  rightRoot: z.string().min(1),
  /** 已排序并截断至 MAX_RESULT_ENTRIES */
  entries: z.array(compareEntrySchema),
  /** 四类计数按全量统计（不受截断影响） */
  onlyLeft: z.number().int().nonnegative(),
  onlyRight: z.number().int().nonnegative(),
  different: z.number().int().nonnegative(),
  same: z.number().int().nonnegative(),
  leftFiles: z.number().int().nonnegative(),
  rightFiles: z.number().int().nonnegative(),
  /** 两侧 stat/目录读取失败被跳过数 */
  skipped: z.number().int().nonnegative(),
  /** 因结果上限被省略的条目数 */
  truncated: z.number().int().nonnegative(),
  compareMtime: z.boolean(),
  elapsedMs: z.number().nonnegative()
})

export type CompareResult = z.infer<typeof compareDoneSchema>

export const configResultSchema = z.object({
  leftRoot: z.string().nullable(),
  rightRoot: z.string().nullable(),
  compareMtime: z.boolean()
})

export type ConfigResult = z.infer<typeof configResultSchema>

export const setConfigPayloadSchema = z.object({
  /** 空串表示清空记忆目录（config 读回归一为 null） */
  leftRoot: z.string().max(32767).optional(),
  rightRoot: z.string().max(32767).optional(),
  compareMtime: z.boolean()
})

export type SetConfigPayload = z.infer<typeof setConfigPayloadSchema>
