/**
 * @file node.ts zip-tool 主进程通道注册
 * @author cuilanchao
 * @date 2026-11-20
 * @description 四通道：config / set-config 同步；pack / unpack 长任务在 worker 线程执行（runTask）。
 *              deps 可注入（vitest 传假 worker 运行器）。
 */
import archiveWorkerPath from './archive.worker.ts?modulePath'
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
  DEFAULT_CONFLICT,
  configResultSchema,
  packDoneSchema,
  packPayloadSchema,
  setConfigPayloadSchema,
  unpackDoneSchema,
  unpackPayloadSchema,
  type ArchiveRequest,
  type ArchiveResult,
  type ConfigResult,
  type PackPayload,
  type PackResult,
  type SetConfigPayload,
  type UnpackPayload,
  type UnpackResult
} from './schema'

/** 打包/解压任务超时（spec §5.2：15 分钟） */
export const ARCHIVE_TIMEOUT_MS = 900_000

/** 设置键（projects settings 命名空间下） */
const KEY_MODE = 'mode'
const KEY_SOURCES = 'packSources'
const KEY_OUTPUT_DIR = 'outputDir'
const KEY_OUTPUT_NAME = 'outputName'
const KEY_ARCHIVE = 'archive'
const KEY_TARGET_DIR = 'targetDir'
const KEY_CONFLICT = 'conflict'

/** 工具可用的外部能力（node.ts 组装真实实现，测试注入假件） */
export interface ZipToolDeps {
  /** 打包/解压 worker 绝对路径（生产 = electron-vite `?modulePath` 构建产物） */
  archiveWorkerPath: string
  run<P, R>(options: RunTaskOptions<P>): Promise<R>
}

/** worker 错误映射：超时/崩溃 → ZP_TASK_FAILED；结构化错误原样透传（队列再归一 CANCELLED） */
export function mapWorkerError(err: unknown): unknown {
  if (err instanceof TaskTimeoutError) {
    return toolError('ZP_TASK_FAILED', `任务超时（${err.timeoutMs}ms）`)
  }
  if (err instanceof TaskCrashError) {
    const cause = err.cause
    const detail = cause instanceof Error ? cause.message : String(cause ?? err.message)
    return toolError('ZP_TASK_FAILED', tail(detail))
  }
  return err
}

/** zod 校验：失败统一 ZP_INVALID_PAYLOAD（取首条 issue 文案） */
function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw toolError('ZP_INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '')
  }
  return parsed.data
}

/** 字符串或 null（非法存量归 null） */
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** 读取设置（非法存量回落默认） */
async function readConfig(ctx: MainPluginContext): Promise<ConfigResult> {
  const mode = await ctx.settings.get<unknown>(KEY_MODE, 'pack')
  const sources = await ctx.settings.get<unknown>(KEY_SOURCES, [])
  const outputDir = await ctx.settings.get<unknown>(KEY_OUTPUT_DIR, null)
  const outputName = await ctx.settings.get<unknown>(KEY_OUTPUT_NAME, null)
  const archive = await ctx.settings.get<unknown>(KEY_ARCHIVE, null)
  const targetDir = await ctx.settings.get<unknown>(KEY_TARGET_DIR, null)
  const conflict = await ctx.settings.get<unknown>(KEY_CONFLICT, DEFAULT_CONFLICT)
  return configResultSchema.parse({
    mode: mode === 'unpack' ? 'unpack' : 'pack',
    packSources: Array.isArray(sources)
      ? sources.filter((item): item is string => typeof item === 'string')
      : [],
    outputDir: stringOrNull(outputDir),
    outputName: stringOrNull(outputName),
    archive: stringOrNull(archive),
    targetDir: stringOrNull(targetDir),
    conflict: conflict === 'skip' ? 'skip' : DEFAULT_CONFLICT
  })
}

/** 写记忆（失败不阻塞本次任务） */
async function remember(ctx: MainPluginContext, payload: SetConfigPayload): Promise<void> {
  await ctx.settings.set(KEY_MODE, payload.mode)
  await ctx.settings.set(KEY_SOURCES, payload.packSources)
  await ctx.settings.set(KEY_OUTPUT_DIR, payload.outputDir)
  await ctx.settings.set(KEY_OUTPUT_NAME, payload.outputName)
  await ctx.settings.set(KEY_ARCHIVE, payload.archive)
  await ctx.settings.set(KEY_TARGET_DIR, payload.targetDir)
  await ctx.settings.set(KEY_CONFLICT, payload.conflict)
}

/** 注册四个通道（config/set-config 同步，pack/unpack 走任务），可注入 deps 供测试 */
export function registerWith(ctx: MainPluginContext, deps: ZipToolDeps): void {
  ctx.registerIpc('config', async (): Promise<ConfigResult> => readConfig(ctx))

  ctx.registerIpc('set-config', async ({ payload }): Promise<ConfigResult> => {
    const parsed = parseOrThrow<SetConfigPayload>(setConfigPayloadSchema, payload)
    await remember(ctx, parsed)
    return readConfig(ctx)
  })

  ctx.registerTask<PackPayload, PackResult>('pack', async (taskCtx) => {
    const parsed = parseOrThrow<PackPayload>(packPayloadSchema, taskCtx.payload)
    // 打包即记忆：下次打开沿用源与输出位置（失败不阻塞本次任务）
    await remember(ctx, {
      mode: 'pack',
      packSources: parsed.sources,
      outputDir: parsed.outputDir,
      outputName: parsed.outputName,
      archive: null,
      targetDir: null,
      conflict: DEFAULT_CONFLICT
    })
    try {
      const result = await deps.run<ArchiveRequest, ArchiveResult>({
        workerPath: deps.archiveWorkerPath,
        payload: { mode: 'pack', payload: parsed },
        timeoutMs: ARCHIVE_TIMEOUT_MS,
        signal: taskCtx.signal,
        onUpdate: taskCtx.emit
      })
      return packDoneSchema.parse(result)
    } catch (err) {
      throw mapWorkerError(err)
    }
  })

  ctx.registerTask<UnpackPayload, UnpackResult>('unpack', async (taskCtx) => {
    const parsed = parseOrThrow<UnpackPayload>(unpackPayloadSchema, taskCtx.payload)
    await remember(ctx, {
      mode: 'unpack',
      packSources: [],
      outputDir: null,
      outputName: null,
      archive: parsed.archive,
      targetDir: parsed.targetDir,
      conflict: parsed.conflict
    })
    try {
      const result = await deps.run<ArchiveRequest, ArchiveResult>({
        workerPath: deps.archiveWorkerPath,
        payload: { mode: 'unpack', payload: parsed },
        timeoutMs: ARCHIVE_TIMEOUT_MS,
        signal: taskCtx.signal,
        onUpdate: taskCtx.emit
      })
      return unpackDoneSchema.parse(result)
    } catch (err) {
      throw mapWorkerError(err)
    }
  })

  ctx.log.info('file-scanner zip registered')
}

/** 生产实现：node-kit worker 运行器 */
export function createNodeDeps(): ZipToolDeps {
  return { archiveWorkerPath, run: runTask }
}

export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
