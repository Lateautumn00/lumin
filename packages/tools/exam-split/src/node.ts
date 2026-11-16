import { access, constants, open } from 'node:fs/promises'
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
import type { OpResult, WorkerRequest } from './pdf-ops'
import {
  cropPayloadSchema,
  deletePayloadSchema,
  mergePayloadSchema,
  rotatePayloadSchema,
  splitPayloadSchema
} from './schema'

/** 执行超时（spec §4：自任务执行起 120s → OP_TIMEOUT） */
export const OP_TIMEOUT_MS = 120_000

/** 工具可用的外部资源（node.ts 组装真实实现，测试注入假件） */
export interface ExamSplitDeps {
  /** worker 绝对路径（生产 = electron-vite `?modulePath` 构建产物；vitest 下该 query 解析不出值，由测试注入） */
  workerPath: string
  checkReadable(path: string): Promise<void>
  checkExclusive(path: string): Promise<void>
  run(options: RunTaskOptions<WorkerRequest>): Promise<OpResult>
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

/** 注册五个任务通道（split/merge/delete/rotate/crop），可注入 deps 供测试 */
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

  ctx.registerTask('split', async ({ payload, signal, emit }) => {
    const parsed = parseWith(splitPayloadSchema, payload)
    await precheckInputs([parsed.inputPath], deps)
    return runWorker({ op: 'split', payload: parsed }, { signal, emit })
  })

  ctx.registerTask('merge', async ({ payload, signal, emit }) => {
    const parsed = parseWith(mergePayloadSchema, payload)
    await precheckInputs(parsed.inputPaths, deps)
    return runWorker({ op: 'merge', payload: parsed }, { signal, emit })
  })

  ctx.registerTask('delete', async ({ payload, signal, emit }) => {
    const parsed = parseWith(deletePayloadSchema, payload)
    await precheckInputs([parsed.inputPath], deps)
    return runWorker({ op: 'delete', payload: parsed }, { signal, emit })
  })

  ctx.registerTask('rotate', async ({ payload, signal, emit }) => {
    const parsed = parseWith(rotatePayloadSchema, payload)
    await precheckInputs([parsed.inputPath], deps)
    return runWorker({ op: 'rotate', payload: parsed }, { signal, emit })
  })

  ctx.registerTask('crop', async ({ payload, signal, emit }) => {
    const parsed = parseWith(cropPayloadSchema, payload)
    await precheckInputs([parsed.inputPath], deps)
    return runWorker({ op: 'crop', payload: parsed }, { signal, emit })
  })
}

/** 生产实现：fs 预检 + 真实 worker（测试可作基底再覆盖） */
export function createNodeDeps(): ExamSplitDeps {
  return {
    workerPath,
    checkReadable: (path) => access(path, constants.R_OK),
    // 读方式打开探测共享冲突（独占句柄 share=None 拒绝任何打开）；'r' 不误判只读文件
    checkExclusive: async (path) => {
      const handle = await open(path, 'r')
      await handle.close()
    },
    run: (options) => runTask<WorkerRequest, OpResult>(options)
  }
}

export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
