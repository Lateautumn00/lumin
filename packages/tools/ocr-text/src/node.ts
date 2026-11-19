/**
 * @file ocr-text 主进程逻辑（recognize 任务 / save-txt / config）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 三段式任务：预检（存在/占用/体积）→ 模型资产校验 → runTask(worker)；
 *              识别在 worker 内跑 onnxruntime-node。保存走 zod → 冲突命名 → 原子写盘。
 *              依赖可注入，单测不触碰真实 OCR 与磁盘。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { access, constants, open, stat } from 'node:fs/promises'
import { join, parse } from 'node:path'
import ocrWorkerPath from './ocr.worker.ts?modulePath'
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
import type { ZodType } from 'zod'
import { errnoCode, isStructuredError, toolError } from './errors'
import type { RecognizeRequest } from './recognize'
import {
  configResultSchema,
  MAX_IMAGE_BYTES,
  recognizePayloadSchema,
  saveTxtPayloadSchema,
  saveTxtResultSchema,
  type RecognizeResult
} from './schema'

/** 识别执行超时（spec §4.2：自任务执行起 120s → OP_TIMEOUT） */
export const OP_TIMEOUT_MS = 120_000

/** 保存所需的最小 fs 子集（单测注入假件） */
export interface SaveFs {
  mkdir(dir: string): void
  writeAtomic(target: string, text: string): void
  exists(path: string): boolean
}

const defaultSaveFs: SaveFs = {
  mkdir: (dir) => mkdirSync(dir, { recursive: true }),
  writeAtomic: (target, text) => writeAtomic(target, text),
  exists: existsSync
}

/** 工具可用的外部能力（node.ts 组装真实实现，测试注入假件） */
export interface OcrTextDeps {
  /** OCR worker 绝对路径（生产 = electron-vite `?modulePath` 构建产物；vitest 下由测试注入） */
  workerPath: string
  checkReadable(path: string): Promise<void>
  checkExclusive(path: string): Promise<void>
  statSize(path: string): Promise<number>
  run(options: RunTaskOptions<RecognizeRequest>): Promise<RecognizeResult>
  /** 模型目录预检 + 定位（每次 recognize 前执行；缺失/损坏 → MODEL_MISSING） */
  ocrBinariesDir(): Promise<string>
  /** 保存 fs（缺省真实 Node fs；单测注入） */
  fs?: SaveFs
}

/** ocr-kit 错误码 → ocr-text 错误码（renderer 只见本工具语义） */
const KIT_CODE_MAP: Readonly<Record<string, 'OCR_FILE_NOT_FOUND' | 'OCR_FILE_LOCKED' | 'OCR_INPUT_INVALID'>> =
  {
    PDF_NOT_FOUND: 'OCR_FILE_NOT_FOUND',
    PDF_LOCKED: 'OCR_FILE_LOCKED',
    PDF_ENCRYPTED: 'OCR_INPUT_INVALID',
    PDF_INVALID: 'OCR_INPUT_INVALID',
    INVALID_PAYLOAD: 'OCR_INPUT_INVALID'
  }

/**
 * worker / 渲染错误映射：超时 → OP_TIMEOUT；崩溃 → OCR_FAILED；
 * ocr-kit 的 PDF_* 码归一为图片语义；其余结构化错误原样透传（队列再归一 CANCELLED）。
 */
export function mapWorkerError(err: unknown): unknown {
  if (err instanceof TaskTimeoutError) return toolError('OP_TIMEOUT')
  if (err instanceof TaskCrashError) {
    const cause = err.cause
    const detail = cause instanceof Error ? cause.message : String(cause ?? err.message)
    return toolError('OCR_FAILED', tail(detail))
  }
  if (isStructuredError(err)) {
    const mapped = KIT_CODE_MAP[err.code]
    if (mapped !== undefined) return toolError(mapped, err.detail)
  }
  return err
}

/** 预检失败 → 结构化错误（ENOENT → 不存在，EBUSY/EPERM/EACCES → 占用） */
function classifyPrecheck(err: unknown): never {
  const kind = classifyPrecheckError(err)
  const detail = errnoCode(err)
  if (kind === 'locked') throw toolError('OCR_FILE_LOCKED', detail)
  throw toolError(
    'OCR_FILE_NOT_FOUND',
    detail || tail(err instanceof Error ? err.message : String(err))
  )
}

function parseWith<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw toolError('OCR_INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '')
  }
  return parsed.data
}

type TaskArgs = Pick<TaskHandlerContext<unknown>, 'signal' | 'emit'>

/** 注册三个通道（recognize / save-txt / config），可注入 deps 供测试 */
export function registerWith(ctx: MainPluginContext, deps: OcrTextDeps): void {
  const saveFs = deps.fs ?? defaultSaveFs
  const defaultOutputDir = join(ctx.paths.userData, 'ocr-text')

  async function imageSize(path: string): Promise<number> {
    try {
      return await deps.statSize(path)
    } catch (err) {
      classifyPrecheck(err)
    }
  }

  async function runOcr(request: RecognizeRequest, args: TaskArgs): Promise<RecognizeResult> {
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
    try {
      await deps.checkReadable(parsed.inputPath)
    } catch (err) {
      classifyPrecheck(err)
    }
    const size = await imageSize(parsed.inputPath)
    if (size > MAX_IMAGE_BYTES) throw toolError('OCR_IMAGE_TOO_LARGE', `体积 ${size} 字节`)
    try {
      await deps.checkExclusive(parsed.inputPath)
    } catch (err) {
      classifyPrecheck(err)
    }
    const binariesDir = await deps.ocrBinariesDir()
    return runOcr({ inputPath: parsed.inputPath, binariesDir }, { signal, emit })
  })

  ctx.registerIpc('save-txt', async ({ payload }) => {
    const parsed = parseWith(saveTxtPayloadSchema, payload)
    try {
      saveFs.mkdir(parsed.outputDir)
    } catch (err) {
      throw toolError('OUTPUT_WRITE_FAILED', errnoCode(err))
    }
    const base = parse(parsed.inputPath).name || 'ocr-text'
    const target = resolveConflictPath(join(parsed.outputDir, `${base}-OCR.txt`), saveFs.exists)
    if (target === null) throw toolError('OUTPUT_WRITE_FAILED', '同名文件过多（超过 99 个）')
    try {
      saveFs.writeAtomic(target, parsed.text)
    } catch (err) {
      throw toolError('OUTPUT_WRITE_FAILED', errnoCode(err))
    }
    await ctx.settings.set('outputDir', parsed.outputDir)
    return saveTxtResultSchema.parse({ output: target })
  })

  ctx.registerIpc('config', async () => {
    const saved = await ctx.settings.get<string | null>('outputDir', null)
    return configResultSchema.parse({ outputDir: saved ?? defaultOutputDir })
  })

  ctx.log.info('ocr-text registered', { defaultOutputDir })
}

/** 生产实现：fs 预检 + 真实 worker + 模型资产预检（测试可作基底再覆盖） */
export function createNodeDeps(binariesRoot: string, workerPath: string): OcrTextDeps {
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
  registerWith(ctx, createNodeDeps(ctx.paths.binaries, ocrWorkerPath))
}
