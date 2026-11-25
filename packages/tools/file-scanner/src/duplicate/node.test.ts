/**
 * @file node.test.ts 重复文件页签主进程通道单测（假 worker 运行器）
 * @author cuilanchao
 * @date 2026-11-25
 * @description dup-config/dup-set-config 同步与回落、dup-scan 记忆与透传、错误映射、createDuplicateDeps
 */
import { TaskCrashError, TaskTimeoutError, type RunTaskOptions } from '@lumin/node-kit'
import type { IpcHandler, MainPluginContext, TaskHandler } from '@lumin/plugin-api'
import type { TaskUpdate } from '@lumin/shared'
import { describe, expect, it, vi } from 'vitest'
import { manifest } from '../manifest'
import {
  createDuplicateDeps,
  mapDuplicateWorkerError,
  registerDuplicate,
  SCAN_TIMEOUT_MS,
  type DuplicateDeps
} from './node'
import { DEFAULT_MIN_BYTES, type ScanResult } from './schema'

/** 空扫描结果（假 worker 默认回包） */
const EMPTY_RESULT: ScanResult = {
  groups: [],
  scannedFiles: 0,
  skipped: 0,
  totalWastedBytes: 0,
  elapsedMs: 0
}

interface Harness {
  ctx: MainPluginContext
  sync: Map<string, IpcHandler<unknown, unknown>>
  tasks: Map<string, TaskHandler<unknown, unknown>>
  settings: Map<string, unknown>
  events: TaskUpdate[]
}

/** 构造可检视的插件上下文 */
function createContext(): Harness {
  const sync = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const events: TaskUpdate[] = []
  const ctx: MainPluginContext = {
    toolId: manifest.id,
    manifest,
    registerIpc: <P, R>(action: string, handler: IpcHandler<P, R>): void => {
      sync.set(action, handler as unknown as IpcHandler<unknown, unknown>)
    },
    registerTask: <P, R>(action: string, handler: TaskHandler<P, R>): void => {
      tasks.set(action, handler as unknown as TaskHandler<unknown, unknown>)
    },
    settings: {
      get: async <T>(key: string, defaultValue: T): Promise<T> => {
        const value = settings.get(key)
        return value === undefined ? defaultValue : (value as T)
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        settings.set(key, value)
      }
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    paths: { temp: 'C:\\temp', userData: 'C:\\userData', binaries: 'C:\\binaries' }
  }
  return { ctx, sync, tasks, settings, events }
}

async function callSync(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  const handler = harness.sync.get(action)
  if (handler === undefined) throw new Error(`未注册同步通道：${action}`)
  return handler({ toolId: manifest.id, action, payload })
}

async function callTask(
  harness: Harness,
  action: string,
  payload: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  const handler = harness.tasks.get(action)
  if (handler === undefined) throw new Error(`未注册任务通道：${action}`)
  return handler({
    toolId: manifest.id,
    action,
    payload,
    taskId: 'task-1',
    signal: signal ?? new AbortController().signal,
    emit: (update) => harness.events.push(update)
  })
}

interface FakeDeps extends DuplicateDeps {
  runs: RunTaskOptions<unknown>[]
}

/** 构造可注入依赖（记录调用） */
function createDeps(runError?: unknown): FakeDeps {
  const runs: RunTaskOptions<unknown>[] = []
  return {
    scanWorkerPath: 'C:\\fake\\scan.worker.js',
    runs,
    run: async <P, R>(runOptions: RunTaskOptions<P>): Promise<R> => {
      runs.push(runOptions as unknown as RunTaskOptions<unknown>)
      if (runError !== undefined) throw runError
      return EMPTY_RESULT as R
    }
  }
}

describe('config / set-config', () => {
  it('缺省 root=null、含子目录、1MB', async () => {
    const harness = createContext()
    registerDuplicate(harness.ctx, createDeps())
    await expect(callSync(harness, 'dup-config', {})).resolves.toEqual({
      root: null,
      recursive: true,
      minBytes: DEFAULT_MIN_BYTES
    })
  })

  it('保存并回读；非法存量回落默认', async () => {
    const harness = createContext()
    registerDuplicate(harness.ctx, createDeps())

    await expect(
      callSync(harness, 'dup-set-config', {
        root: 'C:\\卷',
        recursive: false,
        minBytes: 1024
      })
    ).resolves.toEqual({ root: 'C:\\卷', recursive: false, minBytes: 1024 })
    expect(harness.settings.get('lastRoot')).toBe('C:\\卷')

    harness.settings.set('lastRoot', '')
    harness.settings.set('recursive', 'yes')
    harness.settings.set('minBytes', -5)
    await expect(callSync(harness, 'dup-config', {})).resolves.toEqual({
      root: null,
      recursive: true,
      minBytes: DEFAULT_MIN_BYTES
    })
  })

  it('省略 root 时保留上次目录；入参非法 → INVALID_PAYLOAD', async () => {
    const harness = createContext()
    registerDuplicate(harness.ctx, createDeps())

    await callSync(harness, 'dup-set-config', { root: 'C:\\a', recursive: true, minBytes: 0 })
    await expect(
      callSync(harness, 'dup-set-config', { recursive: true, minBytes: 2048 })
    ).resolves.toMatchObject({ root: 'C:\\a', minBytes: 2048 })

    await expect(
      callSync(harness, 'dup-set-config', { root: 'C:\\a', recursive: 'yes', minBytes: 0 })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
  })
})

describe('dup-scan', () => {
  it('记忆选项，并把请求交给 worker（含超时与取消信号）', async () => {
    const harness = createContext()
    const deps = createDeps()
    registerDuplicate(harness.ctx, deps)
    const controller = new AbortController()

    const result = await callTask(
      harness,
      'dup-scan',
      { root: 'C:\\卷', recursive: false, minBytes: 1024 },
      controller.signal
    )

    expect(result).toEqual(EMPTY_RESULT)
    expect(deps.runs).toHaveLength(1)
    expect(deps.runs[0]).toMatchObject({
      workerPath: 'C:\\fake\\scan.worker.js',
      payload: { root: 'C:\\卷', recursive: false, minBytes: 1024 },
      timeoutMs: SCAN_TIMEOUT_MS,
      signal: controller.signal
    })
    expect(harness.settings.get('lastRoot')).toBe('C:\\卷')
    expect(harness.settings.get('recursive')).toBe(false)
    expect(harness.settings.get('minBytes')).toBe(1024)
  })

  it('入参非法 → INVALID_PAYLOAD 且不启动 worker', async () => {
    const harness = createContext()
    const deps = createDeps()
    registerDuplicate(harness.ctx, deps)

    await expect(
      callTask(harness, 'dup-scan', { root: '', recursive: true, minBytes: 0 })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(deps.runs).toHaveLength(0)
  })

  it('worker 超时/崩溃 → DF_SCAN_FAILED；结构化错误透传', async () => {
    const timeout = createContext()
    registerDuplicate(timeout.ctx, createDeps(new TaskTimeoutError(1000)))
    await expect(
      callTask(timeout, 'dup-scan', { root: 'C:\\a', recursive: true, minBytes: 0 })
    ).rejects.toMatchObject({ code: 'DF_SCAN_FAILED' })

    const crash = createContext()
    registerDuplicate(crash.ctx, createDeps(new TaskCrashError('worker crashed', new Error('oom'))))
    await expect(
      callTask(crash, 'dup-scan', { root: 'C:\\a', recursive: true, minBytes: 0 })
    ).rejects.toMatchObject({ code: 'DF_SCAN_FAILED', detail: 'oom' })

    const structured = createContext()
    registerDuplicate(structured.ctx, createDeps({ code: 'DF_ROOT_INVALID', message: '无法读取扫描目录' }))
    await expect(
      callTask(structured, 'dup-scan', { root: 'C:\\a', recursive: true, minBytes: 0 })
    ).rejects.toMatchObject({ code: 'DF_ROOT_INVALID' })
  })

  it('mapDuplicateWorkerError：非任务类错误原样返回', () => {
    const plain = new Error('plain')
    expect(mapDuplicateWorkerError(plain)).toBe(plain)
    expect(mapDuplicateWorkerError(new TaskCrashError('crashed', 'string-cause'))).toMatchObject({
      code: 'DF_SCAN_FAILED',
      detail: 'string-cause'
    })
    expect(mapDuplicateWorkerError(new TaskCrashError('crashed'))).toMatchObject({
      code: 'DF_SCAN_FAILED',
      detail: 'crashed'
    })
  })
})

describe('createDuplicateDeps', () => {
  it('暴露 node-kit 运行器（worker 路径由 electron-vite ?modulePath 注入）', () => {
    expect(typeof createDuplicateDeps().run).toBe('function')
  })
})
