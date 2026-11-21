/**
 * @file IPC 入参/出参 zod schema（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 端口查询/结束进程、静态服务器生命周期与配置记忆七通道契约
 */
import { z } from 'zod'

/** 端口合法区间 */
export const MIN_PORT = 1
export const MAX_PORT = 65535

/** 端口列表行数上限（超出截断） */
export const MAX_PORT_ROWS = 5000

/** 访问日志环形缓冲容量 */
export const MAX_ACCESS_LOG = 200

/** 状态接口返回的最近访问条数 */
export const ACCESS_LOG_VISIBLE = 50

/** 静态服务器默认端口 */
export const DEFAULT_SERVER_PORT = 8080

export const portNumberSchema = z.number().int().min(MIN_PORT).max(MAX_PORT)

// —— 页签一：端口占用 ——

export const portsQueryPayloadSchema = z.object({
  /** 缺省表示查询全部端口 */
  port: portNumberSchema.optional()
})

export type PortsQueryPayload = z.infer<typeof portsQueryPayloadSchema>

export const portRowSchema = z.object({
  protocol: z.enum(['TCP', 'UDP']),
  localAddress: z.string().min(1),
  port: z.number().int().min(0).max(MAX_PORT),
  /** UDP 无状态列，此处为空串 */
  state: z.string(),
  pid: z.number().int().nonnegative(),
  process: z.string()
})

export type PortRow = z.infer<typeof portRowSchema>

export const portsQueryResultSchema = z.object({
  rows: z.array(portRowSchema),
  truncated: z.boolean(),
  elapsedMs: z.number().nonnegative()
})

export type PortsQueryResult = z.infer<typeof portsQueryResultSchema>

export const portKillPayloadSchema = z.object({
  pid: z.number().int()
})

export type PortKillPayload = z.infer<typeof portKillPayloadSchema>

export const portKillResultSchema = z.object({ ok: z.literal(true) })

export type PortKillResult = z.infer<typeof portKillResultSchema>

// —— 页签三：静态服务器 ——

export const serverStartPayloadSchema = z.object({
  root: z.string().min(1).max(32767),
  port: portNumberSchema
})

export type ServerStartPayload = z.infer<typeof serverStartPayloadSchema>

export const serverStartResultSchema = z.object({
  running: z.literal(true),
  port: portNumberSchema,
  root: z.string().min(1)
})

export type ServerStartResult = z.infer<typeof serverStartResultSchema>

export const emptyPayloadSchema = z.object({}).optional()

export const serverStopResultSchema = z.object({ running: z.literal(false) })

export type ServerStopResult = z.infer<typeof serverStopResultSchema>

export const accessLogSchema = z.object({
  time: z.number().nonnegative(),
  method: z.string().min(1),
  path: z.string(),
  status: z.number().int().min(100).max(599),
  bytes: z.number().int().nonnegative()
})

export type AccessLog = z.infer<typeof accessLogSchema>

export const serverStatusResultSchema = z.object({
  running: z.boolean(),
  port: portNumberSchema.optional(),
  root: z.string().min(1).optional(),
  /** 最近访问（新→旧，最多 ACCESS_LOG_VISIBLE 条） */
  requests: z.array(accessLogSchema)
})

export type ServerStatusResult = z.infer<typeof serverStatusResultSchema>

// —— 配置记忆 ——

export const configResultSchema = z.object({
  root: z.string().min(1).nullable(),
  port: portNumberSchema
})

export type ConfigResult = z.infer<typeof configResultSchema>

export const setConfigPayloadSchema = z.object({
  /** null 表示清空记忆目录 */
  root: z.string().min(1).max(32767).nullable().optional(),
  port: portNumberSchema.optional()
})

export type SetConfigPayload = z.infer<typeof setConfigPayloadSchema>
