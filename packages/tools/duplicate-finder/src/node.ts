/**
 * @file node.ts duplicate-finder 主进程通道注册
 * @author cuilanchao
 * @date 2026-11-19
 * @description 三通道：config / set-config 同步；scan 长任务在 worker 线程执行（exposeTask）。
 *              deps 可注入（vitest 传假 worker 运行器）。
 */
import scanWorkerPath from './scan.worker.ts?modulePath'
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
  DEFAULT_MIN_BYTES,
  DEFAULT_RECURSIVE,
  configResultSchema,
  scanPayloadSchema,
  setConfigPayloadSchema,
  type ConfigResult,
  type ScanPayload,
  type ScanResult,
  type SetConfigPayload
} from './schema'

/** 扫描任务超时（spec §5：15 分钟） */
export const SCAN_TIMEOUT_MS = 900_000

/** 设置键（projects settings 命名空间下） */
const KEY_ROOT = 'lastRoot'
const KEY_RECURSIVE = 'recursive'
const KEY_MIN_BYTES = 'minBytes'

/** 工具可用的外部能力（node.ts 组装真实实现，测试注入假件） */
export interface DuplicateFinderDeps {
  /** 扫描 worker 绝对路径（生产 = electron-vite `?modulePath` 构建产物） */
  scanWorkerPath: string
  run<P, R>(options: RunTaskOptions<P>): Promise<R>
}

/** worker 错误映射：超时/崩溃 → DF_SCAN_FAILED；结构化错误原样透传（队列再归一 CANCELLED） */
export function mapWorkerError(err: unknown): unknown {
  if (err instanceof TaskTimeoutError) {
    return toolError('DF_SCAN_FAILED', `扫描超时（${err.timeoutMs}ms）`)
  }
  if (err instanceof TaskCrashError) {
    const cause = err.cause
    const detail = cause instanceof Error ? cause.message : String(cause ?? err.message)
    return toolError('DF_SCAN_FAILED', detail.slice(0, 200))
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

/** 读取设置（非法存量回落默认：root=null / recursive=true / minBytes=1MB） */
async function readConfig(ctx: MainPluginContext): Promise<ConfigResult> {
  const root = await ctx.settings.get<unknown>(KEY_ROOT, null)
  const recursive = await ctx.settings.get<unknown>(KEY_RECURSIVE, DEFAULT_RECURSIVE)
  const minBytes = await ctx.settings.get<unknown>(KEY_MIN_BYTES, DEFAULT_MIN_BYTES)
  return configResultSchema.parse({
    root: typeof root === 'string' && root !== '' ? root : null,
    recursive: typeof recursive === 'boolean' ? recursive : DEFAULT_RECURSIVE,
    minBytes:
      typeof minBytes === 'number' && Number.isFinite(minBytes) && minBytes >= 0
        ? Math.trunc(minBytes)
        : DEFAULT_MIN_BYTES
  })
}

/** 注册三个通道（config 同步，扫描走任务），可注入 deps 供测试 */
export function registerWith(ctx: MainPluginContext, deps: DuplicateFinderDeps): void {
  ctx.registerIpc('config', async (): Promise<ConfigResult> => readConfig(ctx))

  ctx.registerIpc('set-config', async ({ payload }): Promise<ConfigResult> => {
    const parsed = parseOrThrow<SetConfigPayload>(setConfigPayloadSchema, payload)
    if (parsed.root !== undefined) await ctx.settings.set(KEY_ROOT, parsed.root)
    await ctx.settings.set(KEY_RECURSIVE, parsed.recursive)
    await ctx.settings.set(KEY_MIN_BYTES, parsed.minBytes)
    return readConfig(ctx)
  })

  ctx.registerTask<ScanPayload, ScanResult>('scan', async (taskCtx) => {
    const parsed = parseOrThrow<ScanPayload>(scanPayloadSchema, taskCtx.payload)
    // 扫描即记忆：下次打开沿用目录与选项（失败不阻塞本次任务）
    await ctx.settings.set(KEY_ROOT, parsed.root)
    await ctx.settings.set(KEY_RECURSIVE, parsed.recursive)
    await ctx.settings.set(KEY_MIN_BYTES, parsed.minBytes)
    try {
      return await deps.run<ScanPayload, ScanResult>({
        workerPath: deps.scanWorkerPath,
        payload: parsed,
        timeoutMs: SCAN_TIMEOUT_MS,
        signal: taskCtx.signal,
        onUpdate: taskCtx.emit
      })
    } catch (err) {
      throw mapWorkerError(err)
    }
  })

  ctx.log.info('duplicate-finder registered')
}

/** 生产实现：node-kit worker 运行器 */
export function createNodeDeps(): DuplicateFinderDeps {
  return { scanWorkerPath, run: runTask }
}

export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
