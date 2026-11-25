/**
 * @file schema.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description 文件打印 IPC 入参/回参 zod 契约与任务结果类型（spec §6）。
 */
import { z } from 'zod'
import type { PrintKind } from './formats'

/** jobId 生成规则：小写字母/数字/短横，8–64 位 */
export const JOB_ID_RE = /^[a-z0-9-]{8,64}$/

/** 单条预检/转换失败的投影（单份失败不中断整批） */
export interface PrintFailure {
  inputPath: string
  code: string
  message: string
  detail?: string
}

/** 已就绪的打印任务项（仅在主进程内存中映射到实际产物） */
export interface PrintJob {
  jobId: string
  name: string
  sourcePath: string
  kind: PrintKind
  pageCount?: number
}

/** `print:prepare` done 结果：成功与失败并行上报 */
export interface PrepareResult {
  jobs: PrintJob[]
  failures: PrintFailure[]
}

/** `print:show` done 结果 */
export interface ShowResult {
  jobId: string
  name: string
  pageCount?: number
}

/** `print:status` 返回 */
export interface StatusResult {
  soffice: {
    available: boolean
    path?: string
    customPath: string
  }
}

/** `print:cleanup` 返回 */
export interface CleanupResult {
  removed: number
}

/**
 * prepare 入参：数量上限在 handler 内按 MAX_PRINT_FILES 映射为 PR_TOO_MANY_FILES，
 * 此处仅做防爆上限（200）与结构校验。
 */
export const preparePayloadSchema = z.object({
  inputPaths: z.array(z.string().min(1)).min(1, '至少选择一个文件').max(200)
})

export type PreparePayload = z.infer<typeof preparePayloadSchema>

/** status 入参：传 customPath 即保存为工具设置（spec §6） */
export const statusPayloadSchema = z.object({
  customPath: z.string().max(500).optional()
})

export const showPayloadSchema = z.object({
  jobId: z.string().regex(JOB_ID_RE, 'jobId 非法')
})

export const cleanupPayloadSchema = z.object({
  jobIds: z.array(z.string().regex(JOB_ID_RE, 'jobId 非法')).max(200).optional()
})
