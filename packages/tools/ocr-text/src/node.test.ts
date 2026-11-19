/**
 * @file node.ts 单测（假 ctx/依赖，不依赖 Electron 与真实 OCR）
 * @author cuilanchao
 * @date 2026-11-19
 * @description recognize 预检/体积/错误映射与三段式回调、save-txt 冲突命名与写盘失败、
 *              config 缺省与记忆（spec §5.2/§6）
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  TaskCrashError,
  TaskTimeoutError,
  type RunTaskOptions
} from '@lumin/node-kit'
import type {
  IpcHandler,
  MainPluginContext,
  TaskHandler,
  TaskHandlerContext
} from '@lumin/plugin-api'
import type { StructuredError, TaskUpdate } from '@lumin/shared'
import { toolError } from './errors'
import { manifest } from './manifest'
import {
  mapWorkerError,
  OP_TIMEOUT_MS,
  registerMain,
  registerWith,
  type OcrTextDeps
} from './node'
import type { RecognizeRequest } from './recognize'
import type { RecognizeResult } from './schema'

const RESULT: RecognizeResult = {
  width: 100,
  height: 50,
  lines: [{ text: '你好', x: 0.1, y: 0.1, width: 0.2, height: 0.05 }]
}

interface Harness {
  root: string
  userData: string
  ctx: MainPluginContext
  ipc: Map<string, IpcHandler<unknown, unknown>>
  tasks: Map<string, TaskHandler<unknown, unknown>>
  settings: Map<string, unknown>
  emitted: TaskUpdate[]
  runs: RunTaskOptions<RecognizeRequest>[]
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * 构造假主进程上下文并注册通道
 * @param overrides 覆盖默认假依赖
 */
function createHarness(overrides: Partial<OcrTextDeps> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-ocr-text-'))
  roots.push(root)
  const userData = join(root, 'userData')
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const emitted: TaskUpdate[] = []
  const runs: RunTaskOptions<RecognizeRequest>[] = []

  const ctx = {
    toolId: 'ocr-text',
    manifest,
    registerIpc: (action: string, handler: IpcHandler<unknown, unknown>) => {
      ipc.set(action, handler)
    },
    registerTask: (action: string, handler: TaskHandler<unknown, unknown>) => {
      tasks.set(action, handler)
    },
    settings: {
      get: async <T>(key: string, defaultValue: T): Promise<T> =>
        settings.has(key) ? (settings.get(key) as T) : defaultValue,
      set: async <T>(key: string, value: T): Promise<void> => {
        settings.set(key, value)
      }
    },
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    paths: { temp: root, userData, binaries: root }
  }

  const deps: OcrTextDeps = {
    workerPath: 'C:\\fake\\ocr.worker.js',
    checkReadable: async () => undefined,
    checkExclusive: async () => undefined,
    statSize: async () => 1024,
    run: async (options) => {
      runs.push(options)
      options.onUpdate?.({ kind: 'progress', current: 0, total: 1, message: '识别文字…' })
      return RESULT
    },
    ocrBinariesDir: async () => join(root, 'ocr'),
    fs: {
      mkdir: (dir) => mkdirSync(dir, { recursive: true }),
      writeAtomic: (target, text) => writeFileSync(target, text, 'utf8'),
      exists: existsSync
    },
    ...overrides
  }

  registerWith(ctx as unknown as MainPluginContext, deps)
  return { root, userData, ctx: ctx as unknown as MainPluginContext, ipc, tasks, settings, emitted, runs }
}

function handlerOf(harness: Harness, action: string): IpcHandler<unknown, unknown> {
  const handler = harness.ipc.get(action)
  if (handler === undefined) throw new Error(`未注册通道：${action}`)
  return handler
}

function invoke(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  return Promise.resolve(handlerOf(harness, action)({ toolId: 'ocr-text', action, payload }))
}

function runTask(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  const handler = harness.tasks.get(action)
  if (handler === undefined) throw new Error(`未注册任务：${action}`)
  const ctx: TaskHandlerContext<unknown> = {
    toolId: 'ocr-text',
    action,
    taskId: 'task-1',
    payload,
    signal: new AbortController().signal,
    emit: (update) => harness.emitted.push(update)
  }
  return handler(ctx)
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<StructuredError> {
  try {
    await promise
  } catch (err) {
    const structured = err as StructuredError
    expect(structured.code).toBe(code)
    return structured
  }
  throw new Error(`期望抛出 ${code}，实际成功`)
}

describe('registerMain', () => {
  it('壳入口注册三通道', async () => {
    const harness = createHarness()
    registerMain(harness.ctx)
    expect(harness.ipc.size).toBe(2)
    expect(harness.tasks.size).toBe(1)
    expect(harness.ipc.has('save-txt')).toBe(true)
    expect(harness.ipc.has('config')).toBe(true)
    expect(harness.tasks.has('recognize')).toBe(true)
  })
})

describe('recognize', () => {
  const payload = { inputPath: 'C:\\图片 目录\\截图.png' }

  it('预检通过后以 120s 超时提交 worker 并透传进度', async () => {
    const harness = createHarness()
    await expect(runTask(harness, 'recognize', payload)).resolves.toEqual(RESULT)

    const run = harness.runs[0]
    expect(run?.workerPath).toBe('C:\\fake\\ocr.worker.js')
    expect(run?.timeoutMs).toBe(OP_TIMEOUT_MS)
    expect(run?.payload).toEqual({ inputPath: payload.inputPath, binariesDir: join(harness.root, 'ocr') })
    expect(harness.emitted[0]?.kind).toBe('progress')
  })

  it('非图片扩展名归 OCR_INVALID_PAYLOAD 且不触发 worker', async () => {
    const harness = createHarness()
    await expectCode(runTask(harness, 'recognize', { inputPath: 'a.pdf' }), 'OCR_INVALID_PAYLOAD')
    expect(harness.runs).toHaveLength(0)
  })

  it('ENOENT → OCR_FILE_NOT_FOUND；EBUSY → OCR_FILE_LOCKED', async () => {
    const missing = createHarness({
      checkReadable: async () => {
        throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      }
    })
    await expectCode(runTask(missing, 'recognize', payload), 'OCR_FILE_NOT_FOUND')

    const locked = createHarness({
      checkExclusive: async () => {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      }
    })
    const error = await expectCode(runTask(locked, 'recognize', payload), 'OCR_FILE_LOCKED')
    expect(error.detail).toBe('EBUSY')
  })

  it('超过 20MB 归 OCR_IMAGE_TOO_LARGE 且不触发 worker', async () => {
    const harness = createHarness({ statSize: async () => 20 * 1024 * 1024 + 1 })
    await expectCode(runTask(harness, 'recognize', payload), 'OCR_IMAGE_TOO_LARGE')
    expect(harness.runs).toHaveLength(0)
  })

  it('超时 → OP_TIMEOUT；崩溃 → OCR_FAILED（带 cause 尾部）', async () => {
    const timeout = createHarness({
      run: async () => {
        throw new TaskTimeoutError(120_000)
      }
    })
    await expectCode(runTask(timeout, 'recognize', payload), 'OP_TIMEOUT')

    const crash = createHarness({
      run: async () => {
        throw new TaskCrashError('worker exit', new Error('out of memory'))
      }
    })
    const error = await expectCode(runTask(crash, 'recognize', payload), 'OCR_FAILED')
    expect(error.detail).toContain('out of memory')
  })

  it('mapWorkerError：崩溃原因可为字符串/缺省，未知结构化码原样返回', () => {
    expect(mapWorkerError(new TaskCrashError('worker exit', 'killed'))).toMatchObject({
      code: 'OCR_FAILED',
      detail: 'killed'
    })
    expect(mapWorkerError(new TaskCrashError('worker exit'))).toMatchObject({
      code: 'OCR_FAILED',
      detail: 'worker exit'
    })
    const custom = { code: 'SOMETHING', message: '自定义错误' }
    expect(mapWorkerError(custom)).toBe(custom)
  })

  it('预检异常无 errno 时用异常信息兜底', async () => {
    const harness = createHarness({
      checkReadable: async () => {
        throw new Error('stat failed')
      }
    })
    const error = await expectCode(runTask(harness, 'recognize', payload), 'OCR_FILE_NOT_FOUND')
    expect(error.detail).toContain('stat failed')
  })

  it('ocr-kit 的 PDF_* 码归一为图片语义', async () => {
    const notFound = createHarness({
      run: async () => {
        throw { code: 'PDF_NOT_FOUND', message: '输入文件不存在，请重新选择', detail: 'ENOENT' }
      }
    })
    await expectCode(runTask(notFound, 'recognize', payload), 'OCR_FILE_NOT_FOUND')

    const locked = createHarness({
      run: async () => {
        throw { code: 'PDF_LOCKED', message: '文件被其他程序占用，请关闭后重试', detail: 'EBUSY' }
      }
    })
    await expectCode(runTask(locked, 'recognize', payload), 'OCR_FILE_LOCKED')
  })

  it('模型缺失结构化错误透传', async () => {
    const harness = createHarness({
      ocrBinariesDir: async () => {
        throw toolError('MODEL_MISSING', 'det: ENOENT')
      }
    })
    const error = await expectCode(runTask(harness, 'recognize', payload), 'MODEL_MISSING')
    expect(error.detail).toBe('det: ENOENT')
  })

  it('取消信号原样传给 runTask', async () => {
    const harness = createHarness()
    await runTask(harness, 'recognize', payload)
    expect(harness.runs[0]?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('save-txt / config', () => {
  const payload = (outputDir: string) => ({
    outputDir,
    inputPath: join('C:\\图 片', 'page 1.png'),
    text: '第一行\n第二行'
  })

  it('写盘成功、内容一致并记忆目录', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, '导出 目录')
    const result = (await invoke(harness, 'save-txt', payload(outputDir))) as { output: string }

    expect(result.output).toBe(join(outputDir, 'page 1-OCR.txt'))
    expect(readFileSync(result.output, 'utf8')).toBe('第一行\n第二行')
    expect(harness.settings.get('outputDir')).toBe(outputDir)
  })

  it('同名自动递增 (1)', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, 'dup')
    await invoke(harness, 'save-txt', payload(outputDir))
    const second = (await invoke(harness, 'save-txt', payload(outputDir))) as { output: string }
    expect(second.output).toBe(join(outputDir, 'page 1-OCR(1).txt'))
  })

  it('目录不可建 → OUTPUT_WRITE_FAILED', async () => {
    const harness = createHarness()
    const blocked = join(harness.root, 'blocked')
    writeFileSync(blocked, 'not a dir')
    await expectCode(invoke(harness, 'save-txt', payload(blocked)), 'OUTPUT_WRITE_FAILED')
  })

  it('写盘失败 → OUTPUT_WRITE_FAILED 并带 errno', async () => {
    const harness = createHarness({
      fs: {
        mkdir: () => undefined,
        writeAtomic: () => {
          throw Object.assign(new Error('denied'), { code: 'EPERM' })
        },
        exists: () => false
      }
    })
    const error = await expectCode(
      invoke(harness, 'save-txt', payload(join(harness.root, 'deny'))),
      'OUTPUT_WRITE_FAILED'
    )
    expect(error.detail).toBe('EPERM')
  })

  it('同名耗尽（99 个）→ OUTPUT_WRITE_FAILED', async () => {
    const harness = createHarness({
      fs: { mkdir: () => undefined, writeAtomic: () => undefined, exists: () => true }
    })
    const error = await expectCode(
      invoke(harness, 'save-txt', payload(join(harness.root, 'full'))),
      'OUTPUT_WRITE_FAILED'
    )
    expect(error.detail).toContain('99')
  })

  it('payload 不合法归 OCR_INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expectCode(
      invoke(harness, 'save-txt', { outputDir: '', inputPath: 'a.pdf', text: '' }),
      'OCR_INVALID_PAYLOAD'
    )
  })

  it('config 缺省 userData/ocr-text，导出后返回记忆目录', async () => {
    const harness = createHarness()
    await expect(invoke(harness, 'config', {})).resolves.toEqual({
      outputDir: join(harness.userData, 'ocr-text')
    })
    const outputDir = join(harness.root, 'remember')
    await invoke(harness, 'save-txt', payload(outputDir))
    await expect(invoke(harness, 'config', {})).resolves.toEqual({ outputDir })
  })

  it('未注入 fs 时走真实 Node fs（mkdir + 写盘）', async () => {
    const harness = createHarness({ fs: undefined })
    const outputDir = join(harness.root, '默认 fs 目录')
    const result = (await invoke(harness, 'save-txt', payload(outputDir))) as { output: string }
    expect(existsSync(result.output)).toBe(true)
  })
})
