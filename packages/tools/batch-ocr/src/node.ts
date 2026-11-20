/**
 * @file batch-ocr 主进程逻辑（recognize 任务 / export / config）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 三段式任务：逐张预检（存在/占用/体积）→ 模型资产校验 → runTask(worker)；
 *              预检失败项保留为失败结果，不中断整批。导出走 zod → 冲突命名 → 原子写盘。
 *              依赖可注入，单测不触碰真实 OCR 与磁盘。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { access, constants, open, stat } from 'node:fs/promises'
import { join, parse } from 'node:path'
import batchWorkerPath from './batch.worker.ts?modulePath'
import {
  classifyPrecheckError,
  resolveConflictPath,
  runTask,
  tail,
  TaskCrashError,
  TaskTimeoutError,
  writeAtomic,
  type RunTaskOptions
} from '@lumin/node-kit'
import { ocrModelDir, verifyOcrAssets } from '@lumin/ocr-kit'
import type { MainPluginContext, RegisterMain, TaskHandlerContext } from '@lumin/plugin-api'
import type { StructuredError } from '@lumin/shared'
import type { ZodType } from 'zod'
import { errnoCode, isStructuredError, toolError } from './errors'
import { mergedFileName } from './naming'
import type { RecognizeRequest } from './recognize'
import {
  configResultSchema,
  exportPayloadSchema,
  exportResultSchema,
  MAX_IMAGE_BYTES,
  recognizePayloadSchema,
  recognizeResultSchema,
  type BatchItemResult,
  type RecognizeResult
} from './schema'

/** 批量识别任务超时（单张 ≤3s，50 张留足余量；spec §4.2） */
export const OP_TIMEOUT_MS = 600_000

/** 导出所需的最小 fs 子集（单测注入假件） */
export interface ExportFs {
  mkdir(dir: string): void
  writeAtomic(target: string, text: string): void
  exists(path: string): boolean
}

const defaultExportFs: ExportFs = {
  mkdir: (dir) => mkdirSync(dir, { recursive: true }),
  writeAtomic: (target, text) => writeAtomic(target, text),
  exists: existsSync
}

/** 工具可用的外部能力（node.ts 组装真实实现，测试注入假件） */
export interface BatchOcrDeps {
  /** OCR worker 绝对路径（生产 = electron-vite `?modulePath` 构建产物；vitest 下由测试注入） */
  workerPath: string
  checkReadable(path: string): Promise<void>
  checkExclusive(path: string): Promise<void>
  statSize(path: string): Promise<number>
  run(options: RunTaskOptions<RecognizeRequest>): Promise<RecognizeResult>
  /** 模型目录预检 + 定位（每次 recognize 前执行；缺失/损坏 → MODEL_MISSING） */
  ocrBinariesDir(): Promise<string>
  /** 导出 fs（缺省真实 Node fs；单测注入） */
  fs?: ExportFs
}

/** ocr-kit 错误码 → batch-ocr 错误码（renderer 只见本工具语义） */
const KIT_CODE_MAP: Readonly<
  Record<string, 'BO_FILE_NOT_FOUND' | 'BO_FILE_LOCKED' | 'BO_INPUT_INVALID'>
> = {
  PDF_NOT_FOUND: 'BO_FILE_NOT_FOUND',
  PDF_LOCKED: 'BO_FILE_LOCKED',
  PDF_ENCRYPTED: 'BO_INPUT_INVALID',
  PDF_INVALID: 'BO_INPUT_INVALID',
  INVALID_PAYLOAD: 'BO_INPUT_INVALID'
}

/**
 * worker / 渲染错误映射：超时 → OP_TIMEOUT；崩溃 → BO_OCR_FAILED；
 * ocr-kit 的 PDF_* 码归一为图片语义；其余结构化错误原样透传（队列再归一 CANCELLED）。
 */
export function mapWorkerError(err: unknown): unknown {
  if (err instanceof TaskTimeoutError) return toolError('OP_TIMEOUT')
  if (err instanceof TaskCrashError) {
    const cause = err.cause
    const detail = cause instanceof Error ? cause.message : String(cause ?? err.message)
    return toolError('BO_OCR_FAILED', tail(detail))
  }
  if (isStructuredError(err)) {
    const mapped = KIT_CODE_MAP[err.code]
    if (mapped !== undefined) return toolError(mapped, err.detail)
  }
  return err
}

/** 单张预检失败 → 结构化错误（ENOENT → 不存在，EBUSY/EPERM/EACCES → 占用） */
export function classifyInputError(err: unknown): StructuredError {
  const kind = classifyPrecheckError(err)
  const detail = errnoCode(err)
  if (kind === 'locked') return toolError('BO_FILE_LOCKED', detail)
  return toolError(
    'BO_FILE_NOT_FOUND',
    detail || tail(err instanceof Error ? err.message : String(err))
  )
}

function parseWith<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw toolError('BO_INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '')
  }
  return parsed.data
}

type TaskArgs = Pick<TaskHandlerContext<unknown>, 'signal' | 'emit'>

/** 注册三个通道（recognize / export / config），可注入 deps 供测试 */
export function registerWith(ctx: MainPluginContext, deps: BatchOcrDeps): void {
  const exportFs = deps.fs ?? defaultExportFs
  const defaultOutputDir = join(ctx.paths.userData, 'batch-ocr')

  /** 单张图片预检：可读 + 未独占 + 体积上限；失败返回结构化错误 */
  async function precheckImage(inputPath: string): Promise<StructuredError | null> {
    try {
      await deps.checkReadable(inputPath)
      await deps.checkExclusive(inputPath)
    } catch (err) {
      return classifyInputError(err)
    }
    let size: number
    try {
      size = await deps.statSize(inputPath)
    } catch (err) {
      return classifyInputError(err)
    }
    if (size > MAX_IMAGE_BYTES) {
      return toolError('BO_IMAGE_TOO_LARGE', `体积 ${(size / 1024 / 1024).toFixed(1)}MB`)
    }
    return null
  }

  async function runWorker(request: RecognizeRequest, args: TaskArgs): Promise<RecognizeResult> {
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

  ctx.registerTask('recognize', async ({ payload, signal, emit }) => {
    const parsed = parseWith(recognizePayloadSchema, payload)
    const total = parsed.inputPaths.length
    const prechecked: { path: string; error: StructuredError | null }[] = []

    emit({ kind: 'progress', stage: 'precheck', current: 0, total, message: '检查图片…' })
    for (let index = 0; index < total; index += 1) {
      const inputPath = parsed.inputPaths[index]
      if (inputPath === undefined) continue
      emit({
        kind: 'progress',
        stage: 'precheck',
        current: index,
        total,
        message: `检查第 ${index + 1}/${total} 张…`
      })
      prechecked.push({ path: inputPath, error: await precheckImage(inputPath) })
    }

    const validPaths = prechecked.filter((item) => item.error === null).map((item) => item.path)
    if (validPaths.length === 0) {
      const items: BatchItemResult[] = prechecked.map((item) => ({
        status: 'failed',
        inputPath: item.path,
        error: item.error ?? toolError('BO_INPUT_INVALID')
      }))
      return recognizeResultSchema.parse({ items })
    }

    const binariesDir = await deps.ocrBinariesDir()
    const workerResult = await runWorker({ inputPaths: validPaths, binariesDir }, { signal, emit })

    const byPath = new Map<string, BatchItemResult>()
    for (const item of workerResult.items) byPath.set(item.inputPath, item)

    const items: BatchItemResult[] = prechecked.map((item): BatchItemResult => {
      if (item.error !== null) {
        return { status: 'failed', inputPath: item.path, error: item.error }
      }
      const result = byPath.get(item.path)
      if (result === undefined) {
        return {
          status: 'failed',
          inputPath: item.path,
          error: toolError('BO_OCR_FAILED', '缺少该图片的识别结果')
        }
      }
      return result
    })
    return recognizeResultSchema.parse({ items })
  })

  ctx.registerIpc('export', async ({ payload }) => {
    const parsed = parseWith(exportPayloadSchema, payload)
    try {
      exportFs.mkdir(parsed.outputDir)
    } catch (err) {
      throw toolError('OUTPUT_WRITE_FAILED', errnoCode(err))
    }

    const outputs: string[] = []
    const write = (target: string, text: string): void => {
      try {
        exportFs.writeAtomic(target, text)
      } catch (err) {
        throw toolError('OUTPUT_WRITE_FAILED', errnoCode(err))
      }
    }

    if (parsed.mode === 'per-file') {
      for (const item of parsed.items) {
        const base = parse(item.fileName).name || 'ocr-text'
        const target = resolveConflictPath(
          join(parsed.outputDir, `${base}-OCR.txt`),
          exportFs.exists
        )
        if (target === null) throw toolError('OUTPUT_WRITE_FAILED', '同名文件过多（超过 99 个）')
        write(target, item.text)
        outputs.push(target)
      }
    } else {
      const target = resolveConflictPath(
        join(parsed.outputDir, mergedFileName(new Date())),
        exportFs.exists
      )
      if (target === null) throw toolError('OUTPUT_WRITE_FAILED', '同名文件过多（超过 99 个）')
      write(
        target,
        parsed.items.map((item) => `===== ${item.fileName} =====\n${item.text}`).join('\n\n')
      )
      outputs.push(target)
    }

    await ctx.settings.set('outputDir', parsed.outputDir)
    return exportResultSchema.parse({ outputs })
  })

  ctx.registerIpc('config', async () => {
    const saved = await ctx.settings.get<string | null>('outputDir', null)
    return configResultSchema.parse({ outputDir: saved ?? defaultOutputDir })
  })

  ctx.log.info('batch-ocr registered', { defaultOutputDir })
}

/** 生产实现：fs 预检 + 真实 worker + 模型资产预检（测试可作基底再覆盖） */
export function createNodeDeps(binariesRoot: string, workerPath: string): BatchOcrDeps {
  return {
    workerPath,
    checkReadable: (path) => access(path, constants.R_OK),
    // 读方式打开探测共享冲突（独占句柄 share=None 拒绝任何打开）；'r' 不误判只读文件
    checkExclusive: async (path) => {
      const handle = await open(path, 'r')
      await handle.close()
    },
    statSize: async (path) => (await stat(path)).size,
    run: (options) => runTask<RecognizeRequest, RecognizeResult>(options),
    ocrBinariesDir: async () => {
      const dir = ocrModelDir(binariesRoot)
      await verifyOcrAssets(dir)
      return dir
    }
  }
}

export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps(ctx.paths.binaries, batchWorkerPath))
}
