/**
 * @file node.ts file-hasher 主进程通道注册
 * @author cuilanchao
 * @date 2026-11-19
 * @description 三通道：config / set-config 同步；hash 长任务在 worker 线程执行（exposeTask）。
 *              deps 可注入（vitest 传假 worker 运行器）。
 */
import hashWorkerPath from './hash.worker.ts?modulePath'
import {
  runTask,
  TaskCrashError,
  TaskTimeoutError,
  type RunTaskOptions
} from '@lumin/node-kit'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import { makeError } from '@lumin/shared'
import type { ZodType } from 'zod'
import { toolError } from './errors'
import {
  DEFAULT_ALGORITHMS,
  algorithmSchema,
  configResultSchema,
  hashPayloadSchema,
  setConfigPayloadSchema,
  type ConfigResult,
  type HashPayload,
  type HashResult,
  type SetConfigPayload
} from './schema'

/** 哈希任务超时（20 GB 单文件上限；spec §5 上限 30 分钟） */
export const HASH_TIMEOUT_MS = 1_800_000

/** 设置键：上次勾选算法 */
const SETTINGS_KEY = 'algorithms'

/** 工具可用的外部能力（node.ts 组装真实实现，测试注入假件） */
export interface FileHasherDeps {
  /** 哈希 worker 绝对路径（生产 = electron-vite `?modulePath` 构建产物） */
  hashWorkerPath: string
  run<P, R>(options: RunTaskOptions<P>): Promise<R>
}

/** worker 错误映射：超时/崩溃 → FH_HASH_FAILED；结构化错误原样透传（队列再归一 CANCELLED） */
export function mapWorkerError(err: unknown): unknown {
  if (err instanceof TaskTimeoutError) {
    return toolError('FH_HASH_FAILED', `计算超时（${err.timeoutMs}ms）`)
  }
  if (err instanceof TaskCrashError) {
    const cause = err.cause
    const detail = cause instanceof Error ? cause.message : String(cause ?? err.message)
    return toolError('FH_HASH_FAILED', detail.slice(0, 200))
  }
  return err
}

/** zod 校验：失败统一 INVALID_PAYLOAD（取首条 issue 文案） */
function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw makeError('INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '参数无效')
  }
  return parsed.data
}

/** 读取设置（算法列表归一；异常值回落默认 SHA-256） */
async function readConfig(ctx: MainPluginContext): Promise<ConfigResult> {
  const stored = await ctx.settings.get<unknown>('algorithms', [...DEFAULT_ALGORITHMS])
  const parsed = algorithmSchema.array().safeParse(stored)
  const algorithms =
    parsed.success && parsed.data.length > 0 ? parsed.data : [...DEFAULT_ALGORITHMS]
  return configResultSchema.parse({ algorithms })
}

/** 注册三个通道（config 同步，哈希走任务），可注入 deps 供测试 */
export function registerWith(ctx: MainPluginContext, deps: FileHasherDeps): void {
  ctx.registerIpc('config', async (): Promise<ConfigResult> => readConfig(ctx))

  ctx.registerIpc('set-config', async ({ payload }): Promise<ConfigResult> => {
    const parsed = parseOrThrow<SetConfigPayload>(setConfigPayloadSchema, payload)
    await ctx.settings.set(SETTINGS_KEY, parsed.algorithms)
    return readConfig(ctx)
  })

  ctx.registerTask<HashPayload, HashResult>('hash', async (taskCtx) => {
    const parsed = parseOrThrow<HashPayload>(hashPayloadSchema, taskCtx.payload)
    // 计算即记忆：下次打开沿用算法勾选（失败不阻塞本次任务）
    await ctx.settings.set(SETTINGS_KEY, parsed.algorithms)
    try {
      return await deps.run<HashPayload, HashResult>({
        workerPath: deps.hashWorkerPath,
        payload: parsed,
        timeoutMs: HASH_TIMEOUT_MS,
        signal: taskCtx.signal,
        onUpdate: taskCtx.emit
      })
    } catch (err) {
      throw mapWorkerError(err)
    }
  })

  ctx.log.info('file-hasher registered')
}

/** 生产实现：node-kit worker 运行器 */
export function createNodeDeps(): FileHasherDeps {
  return { hashWorkerPath, run: runTask }
}

export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
