import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskCrashError, TaskTimeoutError, type RunTaskOptions } from '@lumin/node-kit'
import type { IpcHandler, MainPluginContext, TaskHandler } from '@lumin/plugin-api'
import type { TaskUpdate } from '@lumin/shared'
import { manifest } from './manifest'
import {
  createNodeDeps,
  type ExamSplitDeps,
  mapOcrWorkerError,
  mapWorkerError,
  OP_TIMEOUT_MS,
  registerMain,
  registerWith
} from './node'
import type { OcrTaskResult, OcrWorkerRequest } from './ocr-ops'
import type { OpResult, WorkerRequest } from './pdf-ops'

interface Harness {
  tasks: Map<string, TaskHandler<unknown, unknown>>
  calls: RunTaskOptions<WorkerRequest>[]
  ocrCalls: RunTaskOptions<OcrWorkerRequest>[]
  updates: TaskUpdate[]
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createCtx(
  root: string,
  tasks: Map<string, TaskHandler<unknown, unknown>>
): MainPluginContext {
  return {
    toolId: manifest.id,
    manifest,
    registerIpc: <P, R>(_action: string, _handler: IpcHandler<P, R>): void => undefined,
    registerTask: <P, R>(action: string, handler: TaskHandler<P, R>): void => {
      tasks.set(action, handler as unknown as TaskHandler<unknown, unknown>)
    },
    settings: {
      get: async <T>(_key: string, defaultValue: T): Promise<T> => defaultValue,
      set: async () => undefined
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
}

function createHarness(overrides: Partial<ExamSplitDeps> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-exam-node-'))
  roots.push(root)
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const calls: RunTaskOptions<WorkerRequest>[] = []
  const ocrCalls: RunTaskOptions<OcrWorkerRequest>[] = []
  const updates: TaskUpdate[] = []
  const ctx = createCtx(root, tasks)
  const deps: ExamSplitDeps = {
    workerPath: 'fake-worker.js',
    ocrWorkerPath: 'fake-ocr-worker.js',
    checkReadable: async () => undefined,
    checkExclusive: async () => undefined,
    run: async (options) => {
      calls.push(options)
      options.onUpdate?.({ kind: 'progress', stage: 'load', current: 1, total: 1 })
      return { outputPaths: ['out.pdf'] } satisfies OpResult
    },
    runOcr: async (options) => {
      ocrCalls.push(options)
      options.onUpdate?.({ kind: 'progress', stage: 'detect', current: 1, total: 1 })
      return { pages: [] } satisfies OcrTaskResult
    },
    ocrBinariesDir: async () => '/fake/binaries/ocr',
    ...overrides
  }
  registerWith(ctx, deps)
  return { tasks, calls, ocrCalls, updates }
}

async function runTask(
  harness: Harness,
  action: string,
  payload: unknown
): Promise<{ result?: unknown; error?: unknown }> {
  const handler = harness.tasks.get(action)
  if (handler === undefined) throw new Error(`缺少 task：${action}`)
  try {
    const result = await handler({
      toolId: manifest.id,
      action,
      payload,
      taskId: 'task-1',
      signal: new AbortController().signal,
      emit: (update) => harness.updates.push(update)
    })
    return { result }
  } catch (err) {
    return { error: err }
  }
}

function makeInput(root: string, name = '卷.pdf'): string {
  const path = join(root, name)
  writeFileSync(path, '%PDF-1.7 fake')
  return path
}

describe('registerWith 四通道（spec §2 任务表 / §10.4 IPC）', () => {
  it('注册 split/crop/ocr-detect/ocr-export 四个任务', () => {
    const harness = createHarness()
    expect([...harness.tasks.keys()].sort()).toEqual([
      'crop',
      'ocr-detect',
      'ocr-export',
      'split'
    ])
  })

  it('split：合法入参 → 校验+预检+转发 worker，进度透传', async () => {
    const harness = createHarness()
    const root = roots[0]!
    const input = makeInput(root)
    const { result, error } = await runTask(harness, 'split', { inputPath: input, ranges: '1' })
    expect(error).toBeUndefined()
    expect(result).toEqual({ outputPaths: ['out.pdf'] })
    expect(harness.calls).toHaveLength(1)
    const options = harness.calls[0]!
    expect(options.workerPath).toBe('fake-worker.js')
    expect(options.timeoutMs).toBe(OP_TIMEOUT_MS)
    expect(options.payload).toEqual({ op: 'split', payload: { inputPath: input, ranges: '1' } })
    expect(harness.updates[0]).toMatchObject({ stage: 'load' })
  })

  it('crop：box 越界 → INVALID_PAYLOAD，且不触碰预检', async () => {
    const prechecked: string[] = []
    const harness = createHarness({
      checkReadable: async (path) => {
        prechecked.push(path)
      }
    })
    const input = makeInput(roots[0]!)
    const { error } = await runTask(harness, 'crop', {
      inputPath: input,
      box: { x: 0.8, y: 0.1, width: 0.5, height: 0.5 }
    })
    expect(error).toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(prechecked).toHaveLength(0)
    expect(harness.calls).toHaveLength(0)
  })

  it('crop：合法入参 → 校验+预检+转发 worker', async () => {
    const harness = createHarness()
    const input = makeInput(roots[0]!)
    const cropped = await runTask(harness, 'crop', {
      inputPath: input,
      box: { x: 0, y: 0, width: 1, height: 1 }
    })
    expect(cropped.error).toBeUndefined()
    expect(harness.calls[0]?.payload).toMatchObject({ op: 'crop' })
  })

  it('非法入参 → INVALID_PAYLOAD（zod 拒绝，不进 worker）', async () => {
    const harness = createHarness()
    const { error } = await runTask(harness, 'split', { inputPath: 'a.docx', ranges: '1' })
    expect(error).toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(harness.calls).toHaveLength(0)
  })

  it('预检：不可读 → PDF_NOT_FOUND；被独占 → PDF_LOCKED（spec §5）', async () => {
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    const missing = createHarness({ checkReadable: async () => Promise.reject(enoent) })
    const notFound = await runTask(missing, 'split', { inputPath: 'x.pdf', ranges: '1' })
    expect(notFound.error).toMatchObject({ code: 'PDF_NOT_FOUND', detail: 'ENOENT' })

    const busy = Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })
    const locked = createHarness({ checkExclusive: async () => Promise.reject(busy) })
    const lockedResult = await runTask(locked, 'split', { inputPath: 'x.pdf', ranges: '1' })
    expect(lockedResult.error).toMatchObject({ code: 'PDF_LOCKED', detail: 'EBUSY' })
  })

  it('run 抛结构化错误 → 原样透传（worker 内 PDF_ENCRYPTED 等）', async () => {
    const structured = { code: 'PDF_ENCRYPTED', message: 'PDF 已加密' }
    const harness = createHarness({
      run: async () => Promise.reject(structured)
    })
    const { error } = await runTask(harness, 'split', {
      inputPath: makeInput(roots[0]!),
      ranges: '1'
    })
    expect(error).toBe(structured)
  })

  it('ocr-detect：预检 → 模型预检 → 转发 OCR worker（binariesDir 注入，进度透传）', async () => {
    const harness = createHarness()
    const input = join(roots[0]!, '卷.png')
    writeFileSync(input, 'png')
    const { result, error } = await runTask(harness, 'ocr-detect', { inputPath: input })
    expect(error).toBeUndefined()
    expect(result).toEqual({ pages: [] })
    expect(harness.ocrCalls).toHaveLength(1)
    const options = harness.ocrCalls[0]!
    expect(options.workerPath).toBe('fake-ocr-worker.js')
    expect(options.timeoutMs).toBe(OP_TIMEOUT_MS)
    expect(options.payload).toEqual({
      op: 'detect',
      payload: { inputPath: input, rotation: 0 },
      binariesDir: '/fake/binaries/ocr'
    })
    expect(harness.updates.at(-1)).toMatchObject({ kind: 'progress', stage: 'detect' })
  })

  it('ocr-detect：模型预检失败 → MODEL_MISSING 快速失败，不进 worker', async () => {
    const missing = { code: 'MODEL_MISSING', message: '识别模型缺失' }
    const harness = createHarness({ ocrBinariesDir: async () => Promise.reject(missing) })
    const { error } = await runTask(harness, 'ocr-detect', {
      inputPath: join(roots[0]!, '卷.png')
    })
    expect(error).toBe(missing)
    expect(harness.ocrCalls).toHaveLength(0)
  })

  it('ocr-export：预检 + 转发（不预检模型，export 不需模型）', async () => {
    const harness = createHarness({
      ocrBinariesDir: async () => {
        throw new Error('export 不应触碰模型预检')
      }
    })
    const input = join(roots[0]!, '卷.pdf')
    writeFileSync(input, '%PDF-1.7')
    const payload = {
      inputPath: input,
      rotation: 0,
      startNumber: 1,
      exportPdf: true,
      pages: [
        {
          pageNumber: 1,
          width: 100,
          height: 200,
          regions: [{ start: 0, end: 0.5, lines: [] }]
        }
      ]
    }
    const { error } = await runTask(harness, 'ocr-export', payload)
    expect(error).toBeUndefined()
    expect(harness.ocrCalls[0]?.payload).toEqual({ op: 'export', payload })
  })

  it('ocr-export：无题区 → INVALID_PAYLOAD（zod 拒绝，不进 worker）', async () => {
    const harness = createHarness()
    const { error } = await runTask(harness, 'ocr-export', {
      inputPath: join(roots[0]!, '卷.png'),
      startNumber: 1,
      exportPdf: false,
      pages: [{ pageNumber: 1, width: 10, height: 10, regions: [] }]
    })
    expect(error).toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(harness.ocrCalls).toHaveLength(0)
  })

  it('ocr-detect：输入扩展名非白名单 → INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    const { error } = await runTask(harness, 'ocr-detect', { inputPath: 'a.txt' })
    expect(error).toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(harness.ocrCalls).toHaveLength(0)
  })
})

describe('mapWorkerError（spec §4/§5）', () => {
  it('超时 → OP_TIMEOUT', () => {
    expect(mapWorkerError(new TaskTimeoutError(120_000))).toEqual({
      code: 'OP_TIMEOUT',
      message: '处理超时（120 秒），已终止'
    })
  })

  it('崩溃 → OP_FAILED，detail 取 cause 尾部', () => {
    const err = mapWorkerError(
      new TaskCrashError('worker exited', new Error('x'.repeat(400) + 'boom-tail'))
    )
    expect(err).toMatchObject({ code: 'OP_FAILED' })
    expect((err as { detail?: string }).detail?.endsWith('boom-tail')).toBe(true)
    expect(((err as { detail?: string }).detail ?? '').length).toBeLessThanOrEqual(2001)
  })

  it('结构化错误原样返回', () => {
    const structured = { code: 'PDF_INVALID', message: '坏文件' }
    expect(mapWorkerError(structured)).toBe(structured)
  })
})

describe('mapOcrWorkerError（spec §10.5）', () => {
  it('超时 → OP_TIMEOUT', () => {
    expect(mapOcrWorkerError(new TaskTimeoutError(120_000))).toMatchObject({
      code: 'OP_TIMEOUT'
    })
  })

  it('崩溃 → OCR_FAILED，detail 取 cause 尾部', () => {
    const err = mapOcrWorkerError(
      new TaskCrashError('worker exited', new Error('y'.repeat(400) + 'ocr-tail'))
    )
    expect(err).toMatchObject({ code: 'OCR_FAILED' })
    expect((err as { detail?: string }).detail?.endsWith('ocr-tail')).toBe(true)
  })

  it('结构化错误原样返回（MODEL_MISSING/NO_REGIONS 等透传）', () => {
    const structured = { code: 'MODEL_MISSING', message: '识别模型缺失' }
    expect(mapOcrWorkerError(structured)).toBe(structured)
  })
})

describe('createNodeDeps（生产实现）', () => {
  it('checkReadable：存在可读通过，缺失拒绝', async () => {
    const deps = createNodeDeps(tmpdir())
    const path = join(roots[0] ?? mkdtempSync(join(tmpdir(), 'lumin-exam-dep-')), 'ok.pdf')
    if (roots[0] === undefined) roots.push(path)
    writeFileSync(path, 'x')
    await expect(deps.checkReadable(path)).resolves.toBeUndefined()
    await expect(deps.checkReadable(join(path, 'nope.pdf'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('checkExclusive：正常文件可打开关闭', async () => {
    const deps = createNodeDeps(tmpdir())
    const root = mkdtempSync(join(tmpdir(), 'lumin-exam-ex-'))
    roots.push(root)
    const path = join(root, 'a.pdf')
    writeFileSync(path, 'x')
    await expect(deps.checkExclusive(path)).resolves.toBeUndefined()
  })

  it('run：转发 runTask（fixture worker 协议回 done）', async () => {
    const deps = createNodeDeps(tmpdir())
    const workerPath = fileURLToPath(
      new URL('../../../node-kit/fixtures/worker-protocol.mjs', import.meta.url)
    )
    const result = await deps.run({
      workerPath,
      payload: { op: 'split', payload: { inputPath: 'a.pdf', ranges: '1' } },
      timeoutMs: 10_000
    })
    expect(result).toBeNull()
  })

  it('ocrBinariesDir：模型目录不存在 → MODEL_MISSING（spec §10.5）', async () => {
    const deps = createNodeDeps(join(tmpdir(), 'lumin-no-such-binaries'))
    await expect(deps.ocrBinariesDir()).rejects.toMatchObject({ code: 'MODEL_MISSING' })
  })

  it('ocrBinariesDir：真实模型齐全 → 返回 {binaries}/ocr 目录', async () => {
    const binaries = fileURLToPath(new URL('../../../../binaries', import.meta.url))
    // binaries/ 为 gitignore 拉取物（AGENTS §3）；未拉取的环境跳过
    if (!existsSync(join(binaries, 'ocr'))) return
    const deps = createNodeDeps(binaries)
    const dir = await deps.ocrBinariesDir()
    expect(dir).toBe(join(binaries, 'ocr'))
  })
})

describe('registerMain（生产入口）', () => {
  it('组装生产 deps 并注册四通道', () => {
    const root = mkdtempSync(join(tmpdir(), 'lumin-exam-reg-'))
    roots.push(root)
    const tasks = new Map<string, TaskHandler<unknown, unknown>>()
    registerMain(createCtx(root, tasks))
    expect([...tasks.keys()].sort()).toEqual([
      'crop',
      'ocr-detect',
      'ocr-export',
      'split'
    ])
  })
})
