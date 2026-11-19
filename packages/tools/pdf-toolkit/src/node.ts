/**
 * @file node.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description 主进程通道注册：info 同步（页数/元数据）+ 六个 worker 三段式任务。
 *              deps 可注入（vitest 传假 worker 路径与假 inspector）。
 */
import { access, constants, open } from 'node:fs/promises'
import { basename } from 'node:path'
import workerPath from './pdf.worker.ts?modulePath'
import {
  classifyPrecheckError,
  runTask,
  tail,
  TaskCrashError,
  TaskTimeoutError,
  type RunTaskOptions
} from '@lumin/node-kit'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import {
  errnoCode,
  isStructuredError,
  makeError,
  type StructuredError,
  type TaskUpdate
} from '@lumin/shared'
import type { ZodType } from 'zod'
import { toolError } from './errors'
import { inspectPdf, type OpResult, type WorkerRequest } from './pdf-ops'
import {
  deletePayloadSchema,
  infoPayloadSchema,
  mergePayloadSchema,
  metadataPayloadSchema,
  pageNumberPayloadSchema,
  reorderPayloadSchema,
  rotatePayloadSchema,
  splitPayloadSchema,
  watermarkPayloadSchema,
  type InfoResult,
  type PdfMetadata
} from './schema'

/** 任务执行超时（spec §4） */
export const OP_TIMEOUT_MS = 120_000

/** 工具可用的外部资源（生产实现见 createNodeDeps；测试注入假件） */
export interface PdfToolkitDeps {
  /** pdf worker 绝对路径（生产 = electron-vite `?modulePath` 构建产物） */
  workerPath: string
  /** 读取页数与元数据（info 通道） */
  inspect(inputPath: string): Promise<{ pageCount: number; metadata: PdfMetadata }>
  checkReadable(path: string): Promise<void>
  checkExclusive(path: string): Promise<void>
  run<P, R>(options: RunTaskOptions<P>): Promise<R>
}

/** worker 错误映射：超时 → PT_TIMEOUT；崩溃 → PT_OP_FAILED（结构化错误透传） */
export function mapWorkerError(err: unknown): unknown {
  if (err instanceof TaskTimeoutError) return toolError('PT_TIMEOUT')
  if (err instanceof TaskCrashError) {
    const cause = err.cause
    const detail = cause instanceof Error ? cause.message : String(cause ?? err.message)
    return toolError('PT_OP_FAILED', tail(detail))
  }
  return err
}

/** PDF 打开/读取失败 → 结构化错误（结构化错误原样透传） */
export function classifyPdfError(err: unknown): StructuredError {
  if (isStructuredError(err)) return err
  const kind = classifyPrecheckError(err)
  if (kind === 'locked') return toolError('PT_PDF_LOCKED', errnoCode(err))
  if (kind === 'not-found') return toolError('PT_INPUT_INVALID', 'ENOENT')
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('is encrypted')) return toolError('PT_PDF_ENCRYPTED', tail(message))
  return toolError('PT_PDF_CORRUPT', tail(message) || errnoCode(err))
}

/** zod 校验：失败统一 INVALID_PAYLOAD（取首条 issue 文案） */
function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw makeError('INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '参数无效')
  }
  return parsed.data
}

/** 任务上下文里 runWorker 需要的两件事 */
type TaskArgs = { signal: AbortSignal; emit: (update: TaskUpdate) => void }

/** 注册八个通道（info 同步，其余走任务），可注入 deps 供测试 */
export function registerWith(ctx: MainPluginContext, deps: PdfToolkitDeps): void {
  async function precheckInputs(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      try {
        await deps.checkReadable(path)
      } catch (err) {
        throw classifyPdfError(err)
      }
      try {
        await deps.checkExclusive(path)
      } catch (err) {
        throw classifyPdfError(err)
      }
    }
  }

  /** 水印图片来源预检：失败统一 PT_WATERMARK_INVALID（非 PDF 输入） */
  async function precheckImage(path: string): Promise<void> {
    try {
      await deps.checkReadable(path)
      await deps.checkExclusive(path)
    } catch (err) {
      const detail = errnoCode(err) || tail(err instanceof Error ? err.message : String(err))
      throw toolError('PT_WATERMARK_INVALID', detail)
    }
  }

  async function runWorker(request: WorkerRequest, args: TaskArgs): Promise<OpResult> {
    try {
      return await deps.run<WorkerRequest, OpResult>({
        workerPath: deps.workerPath,
        payload: request,
        timeoutMs: OP_TIMEOUT_MS,
        signal: args.signal,
        onUpdate: (update) => args.emit(update)
      })
    } catch (err) {
      throw mapWorkerError(err)
    }
  }

  ctx.registerIpc('info', async ({ payload }): Promise<InfoResult> => {
    const parsed = parseOrThrow(infoPayloadSchema, payload)
    await precheckInputs([parsed.inputPath])
    try {
      const { pageCount, metadata } = await deps.inspect(parsed.inputPath)
      return { pageCount, fileName: basename(parsed.inputPath), metadata }
    } catch (err) {
      throw classifyPdfError(err)
    }
  })

  ctx.registerTask('merge', async ({ payload, signal, emit }) => {
    const parsed = parseOrThrow(mergePayloadSchema, payload)
    await precheckInputs(parsed.inputPaths)
    return runWorker({ op: 'merge', payload: parsed }, { signal, emit })
  })

  ctx.registerTask('split', async ({ payload, signal, emit }) => {
    const parsed = parseOrThrow(splitPayloadSchema, payload)
    await precheckInputs([parsed.inputPath])
    return runWorker({ op: 'split', payload: parsed }, { signal, emit })
  })

  ctx.registerTask('delete', async ({ payload, signal, emit }) => {
    const parsed = parseOrThrow(deletePayloadSchema, payload)
    await precheckInputs([parsed.inputPath])
    return runWorker({ op: 'delete', payload: parsed }, { signal, emit })
  })

  ctx.registerTask('rotate', async ({ payload, signal, emit }) => {
    const parsed = parseOrThrow(rotatePayloadSchema, payload)
    await precheckInputs([parsed.inputPath])
    return runWorker({ op: 'rotate', payload: parsed }, { signal, emit })
  })

  ctx.registerTask('reorder', async ({ payload, signal, emit }) => {
    const parsed = parseOrThrow(reorderPayloadSchema, payload)
    await precheckInputs([parsed.inputPath])
    return runWorker({ op: 'reorder', payload: parsed }, { signal, emit })
  })

  ctx.registerTask('metadata', async ({ payload, signal, emit }) => {
    const parsed = parseOrThrow(metadataPayloadSchema, payload)
    await precheckInputs([parsed.inputPath])
    return runWorker({ op: 'metadata', payload: parsed }, { signal, emit })
  })

  ctx.registerTask('watermark', async ({ payload, signal, emit }) => {
    const parsed = parseOrThrow(watermarkPayloadSchema, payload)
    await precheckInputs([parsed.inputPath])
    if (parsed.kind === 'image') await precheckImage(parsed.imagePath)
    return runWorker({ op: 'watermark', payload: parsed }, { signal, emit })
  })

  ctx.registerTask('page-numbers', async ({ payload, signal, emit }) => {
    const parsed = parseOrThrow(pageNumberPayloadSchema, payload)
    await precheckInputs([parsed.inputPath])
    return runWorker({ op: 'page-numbers', payload: parsed }, { signal, emit })
  })
}

/** 生产实现：fs 预检 + 真实 worker + pdf-lib 信息读取 */
export function createNodeDeps(): PdfToolkitDeps {
  return {
    workerPath,
    inspect: inspectPdf,
    checkReadable: (path) => access(path, constants.R_OK),
    // 读方式打开探测共享冲突（'r' 不误判只读文件）
    checkExclusive: async (path) => {
      const handle = await open(path, 'r')
      await handle.close()
    },
    run: <P, R>(options: RunTaskOptions<P>) => runTask<P, R>(options)
  }
}

export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
