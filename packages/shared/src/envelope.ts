import { z } from 'zod'

/** 通道命名：`{toolId}:{action}`，action 可多段（如 `lumin:settings:get`） */
export const CHANNEL_RE = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/

export const channelSchema = z.string().regex(CHANNEL_RE)

/** 结构化错误（信封形状归 shared，具体错误码由各工具定义，须为 UPPER_SNAKE） */
export const structuredErrorSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1),
  detail: z.string().optional()
})

export type StructuredError = z.infer<typeof structuredErrorSchema>

/** shell 自带的核心错误码；工具错误码在各自包内定义并遵循同一形状 */
export const CORE_ERROR_CODES = [
  'INTERNAL',
  'INVALID_PAYLOAD',
  'NOT_FOUND',
  'NOT_REGISTERED',
  'BUSY',
  'QUEUE_FULL',
  'CANCELLED',
  'TIMEOUT'
] as const

export type CoreErrorCode = (typeof CORE_ERROR_CODES)[number]

export function makeError(code: CoreErrorCode, message: string, detail?: string): StructuredError {
  return detail === undefined ? { code, message } : { code, message, detail }
}

/** 将任意抛出物归一化为结构化错误（已合规的直接透传） */
export function toStructuredError(err: unknown): StructuredError {
  const parsed = structuredErrorSchema.safeParse(err)
  if (parsed.success) return parsed.data
  if (err instanceof Error) return makeError('INTERNAL', err.message)
  return makeError('INTERNAL', String(err))
}

/** renderer → main 的 invoke 请求信封 */
export const invokeRequestSchema = z.object({
  channel: channelSchema,
  payload: z.unknown().optional()
})

export type InvokeRequest = z.infer<typeof invokeRequestSchema>

/** invoke 回包信封（成功/失败二选一） */
export const invokeResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown().optional() }),
  z.object({ ok: z.literal(false), error: structuredErrorSchema })
])

export type InvokeResponse = z.infer<typeof invokeResponseSchema>

/** 长任务提交回包 */
export const submitResultSchema = z.object({
  taskId: z.string().min(1)
})

export type SubmitResult = z.infer<typeof submitResultSchema>

/** 取消请求 */
export const cancelRequestSchema = z.object({
  taskId: z.string().min(1)
})

export type CancelRequest = z.infer<typeof cancelRequestSchema>

/** 任务进度/日志更新（由 taskQueue 补上 taskId 后推送） */
export const taskUpdateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('progress'),
    current: z.number().min(0),
    total: z.number().min(0).optional(),
    message: z.string().optional()
  }),
  z.object({
    kind: z.literal('log'),
    message: z.string().min(1)
  })
])

export type TaskUpdate = z.infer<typeof taskUpdateSchema>

/** main → renderer 推送的完整任务事件（通道 `lumin:task:event`） */
export const taskEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('progress'),
    taskId: z.string().min(1),
    current: z.number().min(0),
    total: z.number().min(0).optional(),
    message: z.string().optional()
  }),
  z.object({
    kind: z.literal('log'),
    taskId: z.string().min(1),
    message: z.string().min(1)
  }),
  z.object({
    kind: z.literal('done'),
    taskId: z.string().min(1),
    result: z.unknown().optional()
  }),
  z.object({
    kind: z.literal('error'),
    taskId: z.string().min(1),
    error: structuredErrorSchema
  })
])

export type TaskEvent = z.infer<typeof taskEventSchema>

/** 任务事件通道（shell 与工具共用的常量） */
export const TASK_EVENT_CHANNEL = 'lumin:task:event'
export const TASK_CANCEL_CHANNEL = 'lumin:task:cancel'

/** renderer → main 的统一 invoke 通道（preload 唯一入口） */
export const LUMIN_INVOKE_CHANNEL = 'lumin:invoke'
