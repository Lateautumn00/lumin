import { access, constants, open } from 'node:fs/promises'
import ocrWorkerPath from './ocr.worker.ts?modulePath'
import workerPath from './pdf.worker.ts?modulePath'
import {
  classifyPrecheckError,
  runTask,
  tail,
  TaskCrashError,
  TaskTimeoutError,
  type RunTaskOptions
} from '@lumin/node-kit'
import type { MainPluginContext, RegisterMain, TaskHandlerContext } from '@lumin/plugin-api'
import { errnoCode } from '@lumin/shared'
import type { ZodType } from 'zod'
import { toolError } from './errors'
import type { OcrTaskResult, OcrWorkerRequest } from './ocr-ops'
import { ocrModelDir, verifyOcrAssets } from './ocr-assets'
import type { OpResult, WorkerRequest } from './pdf-ops'
import {
  cropPayloadSchema,
  ocrDetectPayloadSchema,
  ocrExportPayloadSchema,
  splitPayloadSchema
} from './schema'

/** 执行超时（spec §4：自任务执行起 120s → OP_TIMEOUT） */
export const OP_TIMEOUT_MS = 120_000

/** 工具可用的外部资源（node.ts 组装真实实现，测试注入假件） */
export interface ExamSplitDeps {
  /** pdf worker 绝对路径（生产 = electron-vite `?modulePath` 构建产物；vitest 下该 query 解析不出值，由测试注入） */
  workerPath: string
  /** OCR worker 绝对路径（同上口径） */
  ocrWorkerPath: string
  checkReadable(path: string): Promise<void>
  checkExclusive(path: string): Promise<void>
  run(options: RunTaskOptions<WorkerRequest>): Promise<OpResult>
  runOcr(options: RunTaskOptions<OcrWorkerRequest>): Promise<OcrTaskResult>
  /** 模型目录预检 + 定位（每次 detect 前执行；缺失/损坏 → MODEL_MISSING，spec §10.5） */
  ocrBinariesDir(): Promise<string>
}

/** worker 错误映射：超时/崩溃 → 工具错误码；结构化错误原样透传（队列再归一 CANCELLED） */
export function mapWorkerError(err: unknown): unknown {
  if (err instanceof TaskTimeoutError) return toolError('OP_TIMEOUT')
  if (err instanceof TaskCrashError) {
    const cause = err.cause
    const detail = cause instanceof Error ? cause.message : String(cause ?? err.message)
    return toolError('OP_FAILED', tail(detail))
  }
  return err
}

/** OCR worker 错误映射：超时 → OP_TIMEOUT；崩溃 → OCR_FAILED（detail=cause 尾部，spec §10.5） */
export function mapOcrWorkerError(err: unknown): unknown {
  if (err instanceof TaskTimeoutError) return toolError('OP_TIMEOUT')
  if (err instanceof TaskCrashError) {
    const cause = err.cause
    const detail = cause instanceof Error ? cause.message : String(cause ?? err.message)
    return toolError('OCR_FAILED', tail(detail))
  }
  return err
}

/** 预检失败 → 结构化错误（spec §5：locked → PDF_LOCKED，其余 → PDF_NOT_FOUND） */
function classify(err: unknown): never {
  const kind = classifyPrecheckError(err)
  const detail = errnoCode(err)
  if (kind === 'locked') throw toolError('PDF_LOCKED', detail)
  throw toolError('PDF_NOT_FOUND', detail || tail(err instanceof Error ? err.message : String(err)))
}

/** 预检：逐个输入存在可读 + 未被独占（docx2pdf 同语义） */
async function precheckInputs(paths: readonly string[], deps: ExamSplitDeps): Promise<void> {
  for (const path of paths) {
    try {
      await deps.checkReadable(path)
    } catch (err) {
      classify(err)
    }
    try {
      await deps.checkExclusive(path)
    } catch (err) {
      classify(err)
    }
  }
}

function parseWith<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw toolError('INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '')
  }
  return parsed.data
}

type TaskArgs = Pick<TaskHandlerContext<unknown>, 'signal' | 'emit'>

/** 注册四个任务通道（split/crop/ocr-detect/ocr-export），可注入 deps 供测试 */
export function registerWith(ctx: MainPluginContext, deps: ExamSplitDeps): void {
  async function runWorker(request: WorkerRequest, args: TaskArgs): Promise<OpResult> {
    try {
      return await deps.run({
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

  async function runOcrWorker(request: OcrWorkerRequest, args: TaskArgs): Promise<OcrTaskResult> {
    try {
      return await deps.runOcr({
        workerPath: deps.ocrWorkerPath,
        payload: request,
        timeoutMs: OP_TIMEOUT_MS,
        signal: args.signal,
        onUpdate: (update) => args.emit(update)
      })
    } catch (err) {
      throw mapOcrWorkerError(err)
    }
  }

  ctx.registerTask('split', async ({ payload, signal, emit }) => {
    const parsed = parseWith(splitPayloadSchema, payload)
    await precheckInputs([parsed.inputPath], deps)
    return runWorker({ op: 'split', payload: parsed }, { signal, emit })
  })

  ctx.registerTask('crop', async ({ payload, signal, emit }) => {
    const parsed = parseWith(cropPayloadSchema, payload)
    await precheckInputs([parsed.inputPath], deps)
    return runWorker({ op: 'crop', payload: parsed }, { signal, emit })
  })

  ctx.registerTask('ocr-detect', async ({ payload, signal, emit }) => {
    const parsed = parseWith(ocrDetectPayloadSchema, payload)
    await precheckInputs([parsed.inputPath], deps)
    // 模型预检仅 detect（export 不需模型）；失败 → MODEL_MISSING 快速失败（spec §10.5）
    const binariesDir = await deps.ocrBinariesDir()
    return runOcrWorker({ op: 'detect', payload: parsed, binariesDir }, { signal, emit })
  })

  ctx.registerTask('ocr-export', async ({ payload, signal, emit }) => {
    const parsed = parseWith(ocrExportPayloadSchema, payload)
    await precheckInputs([parsed.inputPath], deps)
    return runOcrWorker({ op: 'export', payload: parsed }, { signal, emit })
  })
}

/** 生产实现：fs 预检 + 真实 worker + 模型资产预检（测试可作基底再覆盖） */
export function createNodeDeps(binariesRoot: string): ExamSplitDeps {
  return {
    workerPath,
    ocrWorkerPath,
    checkReadable: (path) => access(path, constants.R_OK),
    // 读方式打开探测共享冲突（独占句柄 share=None 拒绝任何打开）；'r' 不误判只读文件
    checkExclusive: async (path) => {
      const handle = await open(path, 'r')
      await handle.close()
    },
    run: (options) => runTask<WorkerRequest, OpResult>(options),
    runOcr: (options) => runTask<OcrWorkerRequest, OcrTaskResult>(options),
    ocrBinariesDir: async () => {
      const dir = ocrModelDir(binariesRoot)
      await verifyOcrAssets(dir)
      return dir
    }
  }
}

export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps(ctx.paths.binaries))
}
