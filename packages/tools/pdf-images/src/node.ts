/**
 * @file node.ts pdf-images 主进程通道注册
 * @author cuilanchao
 * @date 2026-11-19
 * @description 五个通道：pdf-info / config / set-output-dir 同步；pdf-to-images /
 *              images-to-pdf 走 worker 长任务。deps 可注入（vitest 传假 worker 路径）。
 */
import { accessSync, constants } from 'node:fs'
import { access, mkdir, open } from 'node:fs/promises'
import { basename, join } from 'node:path'
import pdfWorkerPath from './pdf.worker.ts?modulePath'
import imagesWorkerPath from './images.worker.ts?modulePath'
import {
  classifyPrecheckError,
  runTask,
  tail,
  TaskCrashError,
  TaskTimeoutError,
  type RunTaskOptions
} from '@lumin/node-kit'
import { openPdf } from '@lumin/node-kit/pdf'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import { makeError, type StructuredError } from '@lumin/shared'
import type { ZodType } from 'zod'
import { imageKind } from './contract'
import { errnoCode, toolError } from './errors'
import {
  imagesToPdfPayloadSchema,
  pdfInfoPayloadSchema,
  pdfToImagesPayloadSchema,
  setOutputDirPayloadSchema,
  type ConfigResult,
  type ImagesToPdfRequest,
  type ImagesToPdfResult,
  type PdfInfoResult,
  type PdfToImagesRequest,
  type PdfToImagesResult
} from './schema'

/** 转换超时（大 PDF 逐页渲染；spec §6 上限 10 分钟） */
export const CONVERT_TIMEOUT_MS = 600_000

/** 工具可用的外部资源（node.ts 组装真实实现，测试注入假件） */
export interface PdfImagesDeps {
  /** PDF worker 绝对路径（生产 = electron-vite `?modulePath` 构建产物；vitest 下由测试注入） */
  pdfWorkerPath: string
  /** 图片 worker 绝对路径（同上口径） */
  imagesWorkerPath: string
  run<P, R>(options: RunTaskOptions<P>): Promise<R>
  /** 读 PDF 页数（主进程同步通道用） */
  inspectPdf(path: string): Promise<number>
  checkReadable(path: string): Promise<void>
  checkExclusive(path: string): Promise<void>
  fileExists(path: string): boolean
  makeDir(path: string): Promise<void>
}

/** worker 错误映射：超时/崩溃 → PI_CONVERT_FAILED；结构化错误原样透传（队列再归一 CANCELLED） */
export function mapWorkerError(err: unknown): unknown {
  if (err instanceof TaskTimeoutError) {
    return toolError('PI_CONVERT_FAILED', `执行超时（${err.timeoutMs}ms）`)
  }
  if (err instanceof TaskCrashError) {
    const cause = err.cause
    const detail = cause instanceof Error ? cause.message : String(cause ?? err.message)
    return toolError('PI_CONVERT_FAILED', tail(detail))
  }
  return err
}

/** PDF 打开/读取失败分类（errno 优先，其次 pdfjs 异常名） */
export function classifyPdfError(err: unknown): StructuredError {
  const kind = classifyPrecheckError(err)
  if (kind === 'locked') return toolError('PI_PDF_LOCKED', errnoCode(err))
  if (kind === 'not-found') return toolError('PI_INPUT_INVALID', 'ENOENT')
  const name = err instanceof Error ? err.name : ''
  const message = tail(err instanceof Error ? err.message : String(err))
  if (name === 'PasswordException') return toolError('PI_PDF_ENCRYPTED', message)
  return toolError('PI_PDF_CORRUPT', message || errnoCode(err))
}

/** 预检失败 → 结构化错误（PDF 占用有专属码，图片统一归输入无效） */
function mapPrecheckError(err: unknown, kind: 'pdf' | 'image'): StructuredError {
  const precheck = classifyPrecheckError(err)
  const detail = errnoCode(err)
  if (precheck === 'locked') {
    return kind === 'pdf'
      ? toolError('PI_PDF_LOCKED', detail)
      : toolError('PI_INPUT_INVALID', detail)
  }
  if (precheck === 'not-found') return toolError('PI_INPUT_INVALID', 'ENOENT')
  return kind === 'pdf'
    ? toolError('PI_PDF_CORRUPT', detail)
    : toolError('PI_INPUT_INVALID', detail)
}

/** zod 校验：失败统一 INVALID_PAYLOAD（取首条 issue 文案） */
function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw makeError('INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '参数无效')
  }
  return parsed.data
}

/** 注册五个通道（info/config 同步，转换走任务），可注入 deps 供测试 */
export function registerWith(ctx: MainPluginContext, deps: PdfImagesDeps): void {
  const defaultOutputDir = join(ctx.paths.userData, 'pdf-images-output')
  const ffmpegPath = join(ctx.paths.binaries, 'download', 'ffmpeg.exe')

  /** 逐个预检：存在可读 + 未被独占（docx2pdf/exam-split 同语义） */
  async function precheckInputs(paths: readonly string[], kind: 'pdf' | 'image'): Promise<void> {
    for (const path of paths) {
      try {
        await deps.checkReadable(path)
      } catch (err) {
        throw mapPrecheckError(err, kind)
      }
      try {
        await deps.checkExclusive(path)
      } catch (err) {
        throw mapPrecheckError(err, kind)
      }
    }
  }

  /** 输出目录优先级：请求指定 > 记忆目录 > userData 默认；建目录失败 → PI_OUTPUT_DIR_INVALID */
  async function resolveOutputDir(requested?: string): Promise<string> {
    const saved = await ctx.settings.get('outputDir', '')
    const dir = requested !== undefined ? requested : saved !== '' ? saved : defaultOutputDir
    try {
      await deps.makeDir(dir)
    } catch (err) {
      throw toolError('PI_OUTPUT_DIR_INVALID', errnoCode(err))
    }
    return dir
  }

  ctx.registerIpc('pdf-info', async ({ payload }): Promise<PdfInfoResult> => {
    const parsed = parseOrThrow(pdfInfoPayloadSchema, payload)
    await precheckInputs([parsed.inputPath], 'pdf')
    let pageCount: number
    try {
      pageCount = await deps.inspectPdf(parsed.inputPath)
    } catch (err) {
      throw classifyPdfError(err)
    }
    return { pageCount, fileName: basename(parsed.inputPath) }
  })

  ctx.registerIpc('config', async (): Promise<ConfigResult> => {
    const saved = await ctx.settings.get('outputDir', '')
    return { outputDir: saved !== '' ? saved : defaultOutputDir }
  })

  ctx.registerIpc('set-output-dir', async ({ payload }): Promise<ConfigResult> => {
    const parsed = parseOrThrow(setOutputDirPayloadSchema, payload)
    const dir = await resolveOutputDir(parsed.outputDir)
    await ctx.settings.set('outputDir', dir)
    return { outputDir: dir }
  })

  ctx.registerTask('pdf-to-images', async (taskCtx): Promise<PdfToImagesResult> => {
    const parsed = parseOrThrow(pdfToImagesPayloadSchema, taskCtx.payload)
    await precheckInputs([parsed.inputPath], 'pdf')
    const outputDir = await resolveOutputDir(parsed.outputDir)
    const request: PdfToImagesRequest = {
      inputPath: parsed.inputPath,
      ranges: parsed.ranges,
      format: parsed.format,
      dpi: parsed.dpi,
      outputDir
    }
    try {
      return await deps.run<PdfToImagesRequest, PdfToImagesResult>({
        workerPath: deps.pdfWorkerPath,
        payload: request,
        timeoutMs: CONVERT_TIMEOUT_MS,
        signal: taskCtx.signal,
        onUpdate: taskCtx.emit
      })
    } catch (err) {
      throw mapWorkerError(err)
    }
  })

  ctx.registerTask('images-to-pdf', async (taskCtx): Promise<ImagesToPdfResult> => {
    const parsed = parseOrThrow(imagesToPdfPayloadSchema, taskCtx.payload)
    // 非 png/jpg 需要 ffmpeg 中间转码：缺引擎立即失败（spec §7）
    if (
      parsed.inputPaths.some((path) => imageKind(path) === 'other') &&
      !deps.fileExists(ffmpegPath)
    ) {
      throw toolError('PI_ENGINE_MISSING')
    }
    await precheckInputs(parsed.inputPaths, 'image')
    const outputDir = await resolveOutputDir(parsed.outputDir)
    const request: ImagesToPdfRequest = {
      inputPaths: parsed.inputPaths,
      pageSize: parsed.pageSize,
      orientation: parsed.orientation,
      marginMm: parsed.marginMm,
      ...(parsed.outputName === undefined ? {} : { outputName: parsed.outputName }),
      outputDir,
      ffmpegPath
    }
    try {
      return await deps.run<ImagesToPdfRequest, ImagesToPdfResult>({
        workerPath: deps.imagesWorkerPath,
        payload: request,
        timeoutMs: CONVERT_TIMEOUT_MS,
        signal: taskCtx.signal,
        onUpdate: taskCtx.emit
      })
    } catch (err) {
      throw mapWorkerError(err)
    }
  })
}

/** 生产实现：node:fs + node-kit worker + node-kit/pdf 页数探测 */
export function createNodeDeps(): PdfImagesDeps {
  return {
    pdfWorkerPath,
    imagesWorkerPath,
    run: runTask,
    inspectPdf: async (path) => {
      const { doc, pageCount } = await openPdf(path)
      await doc.cleanup()
      return pageCount
    },
    checkReadable: (path) => access(path, constants.R_OK),
    // 读方式打开探测共享冲突（'r' 而非 'r+'：只读文件不应被误判为占用）
    checkExclusive: async (path) => {
      const handle = await open(path, 'r')
      await handle.close()
    },
    fileExists: (path) => {
      try {
        accessSync(path, constants.F_OK)
        return true
      } catch {
        return false
      }
    },
    makeDir: async (path) => {
      await mkdir(path, { recursive: true })
    }
  }
}

export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
