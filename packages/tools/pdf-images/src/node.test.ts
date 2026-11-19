/**
 * @file node.test.ts node.ts 单测（假 deps 注入，不触真实 worker）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 五通道：pdf-info/config/set-output-dir 同步行为、两个任务入参归一与
 *              预检/引擎/超时/崩溃错误映射
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskCrashError, TaskTimeoutError, type RunTaskOptions } from '@lumin/node-kit'
import type {
  IpcHandler,
  MainPluginContext,
  TaskHandler,
  TaskHandlerContext
} from '@lumin/plugin-api'
import type { TaskUpdate } from '@lumin/shared'
import { manifest } from './manifest'
import { classifyPdfError, mapWorkerError, registerWith, type PdfImagesDeps } from './node'
import type { ImagesToPdfRequest, PdfToImagesRequest } from './schema'

interface HarnessOptions {
  /** tasks.run 的返回值 */
  result?: unknown
  /** inspectPdf 行为 */
  inspectPdf?: (path: string) => Promise<number>
  /** checkReadable/checkExclusive 抛出的错误 */
  precheckError?: unknown
  /** fileExists 返回值（默认 true） */
  engineExists?: boolean
  /** makeDir 抛出的错误 */
  makeDirError?: unknown
}

interface Harness {
  ipc: Map<string, IpcHandler<unknown, unknown>>
  tasks: Map<string, TaskHandler<unknown, unknown>>
  settings: Map<string, unknown>
  calls: RunTaskOptions<unknown>[]
  updates: TaskUpdate[]
  root: string
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function errnoError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

function createHarness(options: HarnessOptions = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-pi-test-'))
  roots.push(root)
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const calls: RunTaskOptions<unknown>[] = []
  const updates: TaskUpdate[] = []

  const deps: PdfImagesDeps = {
    pdfWorkerPath: join(root, 'pdf.worker.js'),
    imagesWorkerPath: join(root, 'images.worker.js'),
    run: <P, R>(runOptions: RunTaskOptions<P>): Promise<R> => {
      calls.push(runOptions as RunTaskOptions<unknown>)
      return Promise.resolve(options.result as R)
    },
    inspectPdf: options.inspectPdf ?? (() => Promise.resolve(3)),
    checkReadable: () =>
      options.precheckError === undefined
        ? Promise.resolve()
        : Promise.reject(options.precheckError),
    checkExclusive: () => Promise.resolve(),
    fileExists: () => options.engineExists ?? true,
    makeDir: async (path) => {
      if (options.makeDirError !== undefined) throw options.makeDirError
      mkdirSync(path, { recursive: true })
    }
  }

  const ctx: MainPluginContext = {
    toolId: manifest.id,
    manifest,
    registerIpc: (action, handler) => {
      ipc.set(action, handler as unknown as IpcHandler<unknown, unknown>)
    },
    registerTask: (action, handler) => {
      tasks.set(action, handler as unknown as TaskHandler<unknown, unknown>)
    },
    settings: {
      get: async (key, defaultValue) =>
        settings.has(key) ? (settings.get(key) as never) : defaultValue,
      set: async (key, value) => {
        settings.set(key, value)
      }
    },
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    paths: {
      temp: join(root, 'temp'),
      userData: join(root, 'userData'),
      binaries: join(root, 'binaries')
    }
  }
  registerWith(ctx, deps)
  return { ipc, tasks, settings, calls, updates, root }
}

function mustGet<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key)
  if (value === undefined) throw new Error(`缺少 handler：${String(key)}`)
  return value
}

async function invokeIpc(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  return mustGet(harness.ipc, action)({ toolId: manifest.id, action, payload })
}

async function runTask(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  const taskCtx: TaskHandlerContext<unknown> = {
    toolId: manifest.id,
    action,
    payload,
    taskId: 'task-1',
    signal: new AbortController().signal,
    emit: (update) => harness.updates.push(update)
  }
  return mustGet(harness.tasks, action)(taskCtx)
}

describe('pdf-info', () => {
  it('返回页数与文件名', async () => {
    const harness = createHarness({ inspectPdf: () => Promise.resolve(7) })
    await expect(invokeIpc(harness, 'pdf-info', { inputPath: 'C:\\卷\\a.pdf' })).resolves.toEqual({
      pageCount: 7,
      fileName: 'a.pdf'
    })
  })

  it('非 PDF / 空参数 → INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expect(invokeIpc(harness, 'pdf-info', { inputPath: 'a.png' })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
    await expect(invokeIpc(harness, 'pdf-info', {})).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })

  it('读盘 ENOENT → PI_INPUT_INVALID', async () => {
    const harness = createHarness({
      inspectPdf: () => Promise.reject(errnoError('ENOENT'))
    })
    await expect(invokeIpc(harness, 'pdf-info', { inputPath: 'a.pdf' })).rejects.toMatchObject({
      code: 'PI_INPUT_INVALID'
    })
  })

  it('预检占用 → PI_PDF_LOCKED', async () => {
    const harness = createHarness({ precheckError: errnoError('EBUSY') })
    await expect(invokeIpc(harness, 'pdf-info', { inputPath: 'a.pdf' })).rejects.toMatchObject({
      code: 'PI_PDF_LOCKED'
    })
  })
})

describe('config / set-output-dir', () => {
  it('缺省返回 userData 下默认目录，设置后返回记忆值', async () => {
    const harness = createHarness()
    const initial = (await invokeIpc(harness, 'config', undefined)) as { outputDir: string }
    expect(initial.outputDir).toBe(join(harness.root, 'userData', 'pdf-images-output'))

    const target = join(harness.root, 'out')
    await expect(invokeIpc(harness, 'set-output-dir', { outputDir: target })).resolves.toEqual({
      outputDir: target
    })
    await expect(invokeIpc(harness, 'config', undefined)).resolves.toEqual({ outputDir: target })
  })

  it('建目录失败 → PI_OUTPUT_DIR_INVALID', async () => {
    const harness = createHarness({ makeDirError: errnoError('EACCES') })
    await expect(
      invokeIpc(harness, 'set-output-dir', { outputDir: 'Z:\\x' })
    ).rejects.toMatchObject({ code: 'PI_OUTPUT_DIR_INVALID' })
  })
})

describe('pdf-to-images', () => {
  it('组装请求并透传 worker 结果与进度', async () => {
    const harness = createHarness({
      result: { outputs: ['a_p1.png'], pages: 1, outputDir: 'x', failures: [] }
    })
    const target = join(harness.root, 'out')
    const result = await runTask(harness, 'pdf-to-images', {
      inputPath: 'C:\\卷\\a.pdf',
      ranges: '2-3',
      format: 'png',
      dpi: 150,
      outputDir: target
    })
    expect(result).toMatchObject({ pages: 1 })
    const call = harness.calls[0]
    expect(call?.workerPath).toBe(join(harness.root, 'pdf.worker.js'))
    expect(call?.payload).toEqual<PdfToImagesRequest>({
      inputPath: 'C:\\卷\\a.pdf',
      ranges: '2-3',
      format: 'png',
      dpi: 150,
      outputDir: target
    })
  })

  it('DPI 非法 → INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expect(
      runTask(harness, 'pdf-to-images', {
        inputPath: 'a.pdf',
        ranges: '',
        format: 'png',
        dpi: 144
      })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
  })

  it('预检占用 → PI_PDF_LOCKED', async () => {
    const locked = createHarness({ precheckError: errnoError('EACCES') })
    await expect(
      runTask(locked, 'pdf-to-images', { inputPath: 'a.pdf', ranges: '', format: 'png', dpi: 72 })
    ).rejects.toMatchObject({ code: 'PI_PDF_LOCKED' })
  })
})

describe('images-to-pdf', () => {
  it('非 png/jpg 缺引擎 → PI_ENGINE_MISSING', async () => {
    const harness = createHarness({ engineExists: false })
    await expect(
      runTask(harness, 'images-to-pdf', {
        inputPaths: ['a.webp'],
        pageSize: 'auto',
        marginMm: 0
      })
    ).rejects.toMatchObject({ code: 'PI_ENGINE_MISSING' })
  })

  it('组装请求（含 ffmpeg 路径）并透传结果', async () => {
    const harness = createHarness({
      result: { output: 'x_合并.pdf', pages: 2, failures: [] }
    })
    const target = join(harness.root, 'out')
    const result = await runTask(harness, 'images-to-pdf', {
      inputPaths: ['a.png', 'b.jpg'],
      pageSize: 'a4',
      marginMm: 10,
      outputDir: target
    })
    expect(result).toMatchObject({ pages: 2 })
    expect(harness.calls[0]?.payload).toEqual<ImagesToPdfRequest>({
      inputPaths: ['a.png', 'b.jpg'],
      pageSize: 'a4',
      marginMm: 10,
      outputDir: target,
      ffmpegPath: join(harness.root, 'binaries', 'download', 'ffmpeg.exe')
    })
  })

  it('超 200 张 / 空列表 / 越界边距 → INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    const many = Array.from({ length: 201 }, (_, index) => `a${index}.png`)
    await expect(
      runTask(harness, 'images-to-pdf', { inputPaths: many, pageSize: 'auto', marginMm: 0 })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    await expect(
      runTask(harness, 'images-to-pdf', { inputPaths: [], pageSize: 'auto', marginMm: 0 })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    await expect(
      runTask(harness, 'images-to-pdf', { inputPaths: ['a.png'], pageSize: 'auto', marginMm: 51 })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
  })

  it('图片预检占用 → PI_INPUT_INVALID', async () => {
    const harness = createHarness({ precheckError: errnoError('EBUSY') })
    await expect(
      runTask(harness, 'images-to-pdf', { inputPaths: ['a.png'], pageSize: 'auto', marginMm: 0 })
    ).rejects.toMatchObject({ code: 'PI_INPUT_INVALID' })
  })
})

describe('mapWorkerError / classifyPdfError', () => {
  it('超时/崩溃 → PI_CONVERT_FAILED，结构化错误透传', () => {
    expect(mapWorkerError(new TaskTimeoutError(5000))).toMatchObject({
      code: 'PI_CONVERT_FAILED'
    })
    expect(mapWorkerError(new TaskCrashError('挂了', new Error('boom')))).toMatchObject({
      code: 'PI_CONVERT_FAILED',
      detail: 'boom'
    })
    const structured = { code: 'PI_RANGE_INVALID', message: '范围错' }
    expect(mapWorkerError(structured)).toBe(structured)
  })

  it('PDF 错误分类：锁定/不存在/加密/损坏', () => {
    expect(classifyPdfError(errnoError('EBUSY'))).toMatchObject({ code: 'PI_PDF_LOCKED' })
    expect(classifyPdfError(errnoError('ENOENT'))).toMatchObject({ code: 'PI_INPUT_INVALID' })
    const password = new Error('need password')
    password.name = 'PasswordException'
    expect(classifyPdfError(password)).toMatchObject({ code: 'PI_PDF_ENCRYPTED' })
    expect(classifyPdfError(new Error('bad xref'))).toMatchObject({ code: 'PI_PDF_CORRUPT' })
  })
})

describe('生产 deps 可被构造', () => {
  it('createNodeDeps 的 fileExists 真实探测', async () => {
    const harness = createHarness()
    const file = join(harness.root, 'x.bin')
    writeFileSync(file, 'x')
    const { createNodeDeps } = await import('./node')
    const deps = createNodeDeps()
    expect(deps.fileExists(file)).toBe(true)
    expect(deps.fileExists(join(harness.root, 'nope'))).toBe(false)
  })
})
