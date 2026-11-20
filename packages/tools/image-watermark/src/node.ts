/**
 * @file node.ts image-watermark 主进程通道注册
 * @author cuilanchao
 * @date 2026-11-20
 * @description 三通道：config / set-output-dir 同步；watermark 走 worker 长任务。
 *              预检（存在/占用/体积）→ 输出目录解析 → runTask；deps 可注入（vitest 假件）。
 */
import { constants } from 'node:fs'
import { access, mkdir, open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import watermarkWorkerPath from './watermark.worker.ts?modulePath'
import {
  classifyPrecheckError,
  runTask,
  tail,
  TaskCrashError,
  TaskTimeoutError,
  type RunTaskOptions
} from '@lumin/node-kit'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import type { StructuredError } from '@lumin/shared'
import type { ZodType } from 'zod'
import { errnoCode, toolError } from './errors'
import {
  configResultSchema,
  MAX_IMAGE_BYTES,
  MAX_WATERMARK_BYTES,
  setOutputDirPayloadSchema,
  watermarkPayloadSchema,
  type ConfigResult,
  type WatermarkRequest,
  type WatermarkResult
} from './schema'

/** 批量水印任务超时（100 张 ≤30s，留足余量；spec §8） */
export const OP_TIMEOUT_MS = 600_000

/** 工具可用的外部资源（node.ts 组装真实实现，测试注入假件） */
export interface ImageWatermarkDeps {
  /** worker 绝对路径（生产 = electron-vite `?modulePath` 构建产物；vitest 下由测试注入） */
  workerPath: string
  run<P, R>(options: RunTaskOptions<P>): Promise<R>
  checkReadable(path: string): Promise<void>
  checkExclusive(path: string): Promise<void>
  statSize(path: string): Promise<number>
  makeDir(path: string): Promise<void>
}

/** worker 错误映射：超时 → OP_TIMEOUT；崩溃 → IW_PROCESS_FAILED；结构化错误透传 */
export function mapWorkerError(err: unknown): unknown {
  if (err instanceof TaskTimeoutError) return toolError('OP_TIMEOUT')
  if (err instanceof TaskCrashError) {
    const cause = err.cause
    const detail = cause instanceof Error ? cause.message : String(cause ?? err.message)
    return toolError('IW_PROCESS_FAILED', tail(detail))
  }
  return err
}

/** 输入图片预检错误分类（占用 / 不存在 / 其它） */
export function classifyInputError(err: unknown): StructuredError {
  const kind = classifyPrecheckError(err)
  const detail = errnoCode(err)
  if (kind === 'locked') return toolError('IW_FILE_LOCKED', detail)
  if (kind === 'not-found') return toolError('IW_INPUT_INVALID', detail || 'ENOENT')
  return toolError('IW_INPUT_INVALID', detail || tail(err instanceof Error ? err.message : String(err)))
}

/** zod 校验：失败统一 IW_INVALID_PAYLOAD（附首条 issue 文案） */
function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw toolError('IW_INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '')
  }
  return parsed.data
}

/** 注册三个通道（config/set-output-dir 同步，watermark 走任务），可注入 deps 供测试 */
export function registerWith(ctx: MainPluginContext, deps: ImageWatermarkDeps): void {
  const defaultOutputDir = join(ctx.paths.userData, 'image-watermark')

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
      throw toolError('IW_IMAGE_TOO_LARGE', `体积 ${(size / 1024 / 1024).toFixed(1)}MB`)
    }
  }

  /** 水印图片预检：不存在 → MISSING；占用/体积超限 → INVALID */
  async function precheckWatermark(path: string): Promise<void> {
    try {
      await deps.checkReadable(path)
    } catch (err) {
      if (classifyPrecheckError(err) === 'not-found') {
        throw toolError('IW_WATERMARK_MISSING', errnoCode(err))
      }
      throw toolError('IW_WATERMARK_INVALID', errnoCode(err))
    }
    try {
      await deps.checkExclusive(path)
    } catch (err) {
      throw toolError('IW_WATERMARK_INVALID', errnoCode(err))
    }
    let size: number
    try {
      size = await deps.statSize(path)
    } catch (err) {
      throw toolError('IW_WATERMARK_INVALID', errnoCode(err))
    }
    if (size > MAX_WATERMARK_BYTES) {
      throw toolError('IW_WATERMARK_INVALID', `体积 ${(size / 1024 / 1024).toFixed(1)}MB`)
    }
  }

  /** 输出目录优先级：请求指定 > 记忆目录 > userData 默认；建目录失败 → IW_OUTPUT_DIR_INVALID */
  async function resolveOutputDir(requested?: string): Promise<string> {
    const saved = await ctx.settings.get('outputDir', '')
    const dir = requested !== undefined ? requested : saved !== '' ? saved : defaultOutputDir
    try {
      await deps.makeDir(dir)
    } catch (err) {
      throw toolError('IW_OUTPUT_DIR_INVALID', errnoCode(err))
    }
    return dir
  }

  ctx.registerIpc('config', async (): Promise<ConfigResult> => {
    const saved = await ctx.settings.get('outputDir', '')
    return configResultSchema.parse({ outputDir: saved !== '' ? saved : defaultOutputDir })
  })

  ctx.registerIpc('set-output-dir', async ({ payload }): Promise<ConfigResult> => {
    const parsed = parseOrThrow(setOutputDirPayloadSchema, payload)
    const dir = await resolveOutputDir(parsed.outputDir)
    await ctx.settings.set('outputDir', dir)
    return configResultSchema.parse({ outputDir: dir })
  })

  ctx.registerTask('watermark', async (taskCtx): Promise<WatermarkResult> => {
    const parsed = parseOrThrow(watermarkPayloadSchema, taskCtx.payload)
    for (const path of parsed.inputPaths) {
      await precheckImage(path)
    }
    if (parsed.watermark.type === 'image') {
      await precheckWatermark(parsed.watermark.watermarkPath)
    }
    const outputDir = await resolveOutputDir(parsed.outputDir)
    const request: WatermarkRequest = {
      inputPaths: parsed.inputPaths,
      watermark: parsed.watermark,
      outputDir
    }
    try {
      return await deps.run<WatermarkRequest, WatermarkResult>({
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

  ctx.log.info('image-watermark registered', { defaultOutputDir })
}

/** 生产实现：node:fs 预检/建目录 + node-kit runTask */
export function createNodeDeps(): ImageWatermarkDeps {
  return {
    workerPath: watermarkWorkerPath,
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

export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
