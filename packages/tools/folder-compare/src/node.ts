/**
 * @file node.ts folder-compare 主进程通道注册
 * @author cuilanchao
 * @date 2026-11-20
 * @description 三通道：config / set-config 同步；compare 长任务在 worker 线程执行（runTask）。
 *              deps 可注入（vitest 传假 worker 运行器）。
 */
import compareWorkerPath from './compare.worker.ts?modulePath'
import {
  runTask,
  TaskCrashError,
  TaskTimeoutError,
  tail,
  type RunTaskOptions
} from '@lumin/node-kit'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import type { ZodType } from 'zod'
import { toolError } from './errors'
import {
  DEFAULT_COMPARE_CONTENT,
  DEFAULT_COMPARE_MTIME,
  comparePayloadSchema,
  configResultSchema,
  setConfigPayloadSchema,
  type ComparePayload,
  type CompareResult,
  type ConfigResult,
  type SetConfigPayload
} from './schema'

/** 对比任务超时（spec §5.2：15 分钟） */
export const COMPARE_TIMEOUT_MS = 900_000

/** 设置键（projects settings 命名空间下） */
const KEY_LEFT_ROOT = 'leftRoot'
const KEY_RIGHT_ROOT = 'rightRoot'
const KEY_COMPARE_MTIME = 'compareMtime'
const KEY_COMPARE_CONTENT = 'compareContent'

/** 工具可用的外部能力（node.ts 组装真实实现，测试注入假件） */
export interface FolderCompareDeps {
  /** 对比 worker 绝对路径（生产 = electron-vite `?modulePath` 构建产物） */
  compareWorkerPath: string
  run<P, R>(options: RunTaskOptions<P>): Promise<R>
}

/** worker 错误映射：超时/崩溃 → FC_COMPARE_FAILED；结构化错误原样透传（队列再归一 CANCELLED） */
export function mapWorkerError(err: unknown): unknown {
  if (err instanceof TaskTimeoutError) {
    return toolError('FC_COMPARE_FAILED', `对比超时（${err.timeoutMs}ms）`)
  }
  if (err instanceof TaskCrashError) {
    const cause = err.cause
    const detail = cause instanceof Error ? cause.message : String(cause ?? err.message)
    return toolError('FC_COMPARE_FAILED', tail(detail))
  }
  return err
}

/** zod 校验：失败统一 FC_INVALID_PAYLOAD（取首条 issue 文案） */
function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw toolError('FC_INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '')
  }
  return parsed.data
}

/** 读取设置（非法存量回落默认：目录 null / compareMtime=true） */
async function readConfig(ctx: MainPluginContext): Promise<ConfigResult> {
  const left = await ctx.settings.get<unknown>(KEY_LEFT_ROOT, null)
  const right = await ctx.settings.get<unknown>(KEY_RIGHT_ROOT, null)
  const compareMtime = await ctx.settings.get<unknown>(KEY_COMPARE_MTIME, DEFAULT_COMPARE_MTIME)
  const compareContent = await ctx.settings.get<unknown>(KEY_COMPARE_CONTENT, DEFAULT_COMPARE_CONTENT)
  return configResultSchema.parse({
    leftRoot: typeof left === 'string' && left !== '' ? left : null,
    rightRoot: typeof right === 'string' && right !== '' ? right : null,
    compareMtime: typeof compareMtime === 'boolean' ? compareMtime : DEFAULT_COMPARE_MTIME,
    compareContent: typeof compareContent === 'boolean' ? compareContent : DEFAULT_COMPARE_CONTENT
  })
}

/** 注册三个通道（config/set-config 同步，对比走任务），可注入 deps 供测试 */
export function registerWith(ctx: MainPluginContext, deps: FolderCompareDeps): void {
  ctx.registerIpc('config', async (): Promise<ConfigResult> => readConfig(ctx))

  ctx.registerIpc('set-config', async ({ payload }): Promise<ConfigResult> => {
    const parsed = parseOrThrow<SetConfigPayload>(setConfigPayloadSchema, payload)
    if (parsed.leftRoot !== undefined) await ctx.settings.set(KEY_LEFT_ROOT, parsed.leftRoot)
    if (parsed.rightRoot !== undefined) await ctx.settings.set(KEY_RIGHT_ROOT, parsed.rightRoot)
    await ctx.settings.set(KEY_COMPARE_MTIME, parsed.compareMtime)
    await ctx.settings.set(KEY_COMPARE_CONTENT, parsed.compareContent)
    return readConfig(ctx)
  })

  ctx.registerTask<ComparePayload, CompareResult>('compare', async (taskCtx) => {
    const parsed = parseOrThrow<ComparePayload>(comparePayloadSchema, taskCtx.payload)
    // 对比即记忆：下次打开沿用左右目录与开关（失败不阻塞本次任务）
    await ctx.settings.set(KEY_LEFT_ROOT, parsed.leftRoot)
    await ctx.settings.set(KEY_RIGHT_ROOT, parsed.rightRoot)
    await ctx.settings.set(KEY_COMPARE_MTIME, parsed.compareMtime)
    await ctx.settings.set(KEY_COMPARE_CONTENT, parsed.compareContent)
    try {
      return await deps.run<ComparePayload, CompareResult>({
        workerPath: deps.compareWorkerPath,
        payload: parsed,
        timeoutMs: COMPARE_TIMEOUT_MS,
        signal: taskCtx.signal,
        onUpdate: taskCtx.emit
      })
    } catch (err) {
      throw mapWorkerError(err)
    }
  })

  ctx.log.info('folder-compare registered')
}

/** 生产实现：node-kit worker 运行器 */
export function createNodeDeps(): FolderCompareDeps {
  return { compareWorkerPath, run: runTask }
}

export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
