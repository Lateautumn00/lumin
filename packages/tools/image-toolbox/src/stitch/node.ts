/**
 * @file stitch/node.ts 图片拼接页签主进程通道（M72 合并自 image-stitch）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 四通道：stitch-config / stitch-set-output-dir 同步；stitch / split 走 worker 长任务。
 *              预检（存在/占用/体积）→ 输出目录解析 → runTask；deps 可注入（vitest 假件）。
 */
import { constants } from 'node:fs'
import { access, mkdir, open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import stitchWorkerPath from './stitch.worker.ts?modulePath'
import splitWorkerPath from './split.worker.ts?modulePath'
import {
  classifyPrecheckError,
  runTask,
  tail,
  TaskCrashError,
  TaskTimeoutError,
  type RunTaskOptions
} from '@lumin/node-kit'
import type { MainPluginContext } from '@lumin/plugin-api'
import type { StructuredError } from '@lumin/shared'
import type { ZodType } from 'zod'
import { errnoCode, toolError } from './errors'
import {
  configResultSchema,
  MAX_IMAGE_BYTES,
  setOutputDirPayloadSchema,
  stitchPayloadSchema,
  splitPayloadSchema,
  type ConfigResult,
  type SplitRequest,
  type SplitResult,
  type StitchRequest,
  type StitchResult
} from './schema'

/** 拼接任务超时（100 张 ≤60s，留足余量；spec §8） */
export const OP_TIMEOUT_MS = 600_000

/** 工具可用的外部资源（node.ts 组装真实实现，测试注入假件） */
export interface ImageStitchDeps {
  /** worker 绝对路径（生产 = electron-vite `?modulePath` 构建产物；vitest 下由测试注入） */
  workerPath: string
  /** 长图分割 worker 绝对路径（M40，同裁剪产物机制） */
  splitWorkerPath: string
  run<P, R>(options: RunTaskOptions<P>): Promise<R>
  checkReadable(path: string): Promise<void>
  checkExclusive(path: string): Promise<void>
  statSize(path: string): Promise<number>
  makeDir(path: string): Promise<void>
}

/** worker 错误映射：超时 → OP_TIMEOUT；崩溃 → IS_PROCESS_FAILED；结构化错误透传 */
export function mapWorkerError(err: unknown): unknown {
  if (err instanceof TaskTimeoutError) return toolError('OP_TIMEOUT')
  if (err instanceof TaskCrashError) {
    const cause = err.cause
    const detail = cause instanceof Error ? cause.message : String(cause ?? err.message)
    return toolError('IS_PROCESS_FAILED', tail(detail))
  }
  return err
}

/** 输入图片预检错误分类（占用 / 不存在 / 其它） */
export function classifyInputError(err: unknown): StructuredError {
  const kind = classifyPrecheckError(err)
  const detail = errnoCode(err)
  if (kind === 'locked') return toolError('IS_FILE_LOCKED', detail)
  if (kind === 'not-found') return toolError('IS_INPUT_INVALID', detail || 'ENOENT')
  return toolError(
    'IS_INPUT_INVALID',
    detail || tail(err instanceof Error ? err.message : String(err))
  )
}

/** zod 校验：失败统一 IS_INVALID_PAYLOAD（附首条 issue 文案） */
function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw toolError('IS_INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '')
  }
  return parsed.data
}

/** 注册三个通道（config/set-output-dir 同步，stitch 走任务），可注入 deps 供测试 */
export function registerWith(ctx: MainPluginContext, deps: ImageStitchDeps): void {
  const defaultOutputDir = join(ctx.paths.userData, 'image-stitch')

  /** 单张图片预检：可读 + 未独占 + 体积上限 */
  async function precheckImage(path: string): Promise<void> {
    try {
      await deps.checkReadable(path)
      await deps.checkExclusive(path)
    } catch (err) {
      throw classifyInputError(err)
    }
    let size: number
    try {
      size = await deps.statSize(path)
    } catch (err) {
      throw classifyInputError(err)
    }
    if (size > MAX_IMAGE_BYTES) {
      throw toolError('IS_IMAGE_TOO_LARGE', `体积 ${(size / 1024 / 1024).toFixed(1)}MB`)
    }
  }

  /** 输出目录优先级：请求指定 > 记忆目录 > userData 默认；建目录失败 → IS_OUTPUT_DIR_INVALID */
  async function resolveOutputDir(requested?: string): Promise<string> {
    const saved = await ctx.settings.get('stitchOutputDir', '')
    const dir = requested !== undefined ? requested : saved !== '' ? saved : defaultOutputDir
    try {
      await deps.makeDir(dir)
    } catch (err) {
      throw toolError('IS_OUTPUT_DIR_INVALID', errnoCode(err))
    }
    return dir
  }

  ctx.registerIpc('stitch-config', async (): Promise<ConfigResult> => {
    const saved = await ctx.settings.get('stitchOutputDir', '')
    return configResultSchema.parse({ outputDir: saved !== '' ? saved : defaultOutputDir })
  })

  ctx.registerIpc('stitch-set-output-dir', async ({ payload }): Promise<ConfigResult> => {
    const parsed = parseOrThrow(setOutputDirPayloadSchema, payload)
    const dir = await resolveOutputDir(parsed.outputDir)
    await ctx.settings.set('stitchOutputDir', dir)
    return configResultSchema.parse({ outputDir: dir })
  })

  ctx.registerTask('stitch', async (taskCtx): Promise<StitchResult> => {
    const parsed = parseOrThrow(stitchPayloadSchema, taskCtx.payload)
    for (const path of parsed.inputPaths) {
      await precheckImage(path)
    }
    const outputDir = await resolveOutputDir(parsed.outputDir)
    const request: StitchRequest = {
      inputPaths: parsed.inputPaths,
      layout: parsed.layout,
      encoder: parsed.encoder,
      quality: parsed.quality,
      bgColor: parsed.bgColor,
      outputDir
    }
    try {
      return await deps.run<StitchRequest, StitchResult>({
        workerPath: deps.workerPath,
        payload: request,
        timeoutMs: OP_TIMEOUT_MS,
        signal: taskCtx.signal,
        onUpdate: taskCtx.emit
      })
    } catch (err) {
      throw mapWorkerError(err)
    }
  })

  // —— 长图分割（M40，spec §5.1–§5.4）：单张预检 → 输出目录解析 → worker 切段 ——
  ctx.registerTask('split', async (taskCtx): Promise<SplitResult> => {
    const parsed = parseOrThrow(splitPayloadSchema, taskCtx.payload)
    await precheckImage(parsed.inputPath)
    const outputDir = await resolveOutputDir(parsed.outputDir)
    const request: SplitRequest = {
      inputPath: parsed.inputPath,
      mode: parsed.mode,
      height: parsed.height,
      parts: parsed.parts,
      quality: parsed.quality,
      outputDir
    }
    try {
      return await deps.run<SplitRequest, SplitResult>({
        workerPath: deps.splitWorkerPath,
        payload: request,
        timeoutMs: OP_TIMEOUT_MS,
        signal: taskCtx.signal,
        onUpdate: taskCtx.emit
      })
    } catch (err) {
      throw mapWorkerError(err)
    }
  })

  ctx.log.info('image-toolbox stitch registered', { defaultOutputDir })
}

/** 生产实现：node:fs 预检/建目录 + node-kit runTask */
export function createNodeDeps(): ImageStitchDeps {
  return {
    workerPath: stitchWorkerPath,
    splitWorkerPath,
    run: runTask,
    checkReadable: (path) => access(path, constants.R_OK),
    // 读方式打开探测共享冲突（'r' 不误判只读文件）
    checkExclusive: async (path) => {
      const handle = await open(path, 'r')
      await handle.close()
    },
    statSize: async (path) => (await stat(path)).size,
    makeDir: async (path) => {
      await mkdir(path, { recursive: true })
    }
  }
}
