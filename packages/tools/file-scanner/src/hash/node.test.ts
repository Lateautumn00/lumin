/**
 * @file node.test.ts 文件校验页签主进程通道单测（假 worker 运行器）
 * @author cuilanchao
 * @date 2026-11-25
 * @description hash-config/hash-set-config 同步、hash 参数记忆与透传、错误映射、createHashDeps
 */
import { TaskCrashError, TaskTimeoutError, type RunTaskOptions } from '@lumin/node-kit'
import type { IpcHandler, MainPluginContext, TaskHandler } from '@lumin/plugin-api'
import type { TaskUpdate } from '@lumin/shared'
import { describe, expect, it, vi } from 'vitest'
import { manifest } from '../manifest'
import {
  createHashDeps,
  HASH_TIMEOUT_MS,
  mapHashWorkerError,
  registerHash,
  type HashDeps
} from './node'
import type { HashResult } from './schema'

/** 空哈希结果（假 worker 默认回包） */
const EMPTY_RESULT: HashResult = { results: [], failedCount: 0, totalBytes: 0, elapsedMs: 0 }

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

/** 同步通道调用 */
async function callSync(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  const handler = harness.sync.get(action)
  if (handler === undefined) throw new Error(`未注册同步通道：${action}`)
  return handler({ toolId: manifest.id, action, payload })
}

/** 任务通道调用（返回结果或抛出错误） */
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

interface FakeDeps extends HashDeps {
  runs: RunTaskOptions<unknown>[]
}

/** 构造可注入依赖（记录调用） */
function createDeps(runError?: unknown): FakeDeps {
  const runs: RunTaskOptions<unknown>[] = []
  return {
    hashWorkerPath: 'C:\\fake\\hash.worker.js',
    runs,
    run: async <P, R>(runOptions: RunTaskOptions<P>): Promise<R> => {
      runs.push(runOptions as unknown as RunTaskOptions<unknown>)
      if (runError !== undefined) throw runError
      return EMPTY_RESULT as R
    }
  }
}

describe('config / set-config', () => {
  it('缺省仅 SHA-256', async () => {
    const harness = createContext()
    registerHash(harness.ctx, createDeps())

    await expect(callSync(harness, 'hash-config', {})).resolves.toEqual({ algorithms: ['sha256'] })
  })

  it('保存算法并回读；非法存量回落默认', async () => {
    const harness = createContext()
    registerHash(harness.ctx, createDeps())

    await expect(callSync(harness, 'hash-set-config', { algorithms: ['md5', 'sha256'] })).resolves.toEqual(
      { algorithms: ['md5', 'sha256'] }
    )
    expect(harness.settings.get('algorithms')).toEqual(['md5', 'sha256'])

    harness.settings.set('algorithms', ['sha512'])
    await expect(callSync(harness, 'hash-config', {})).resolves.toEqual({ algorithms: ['sha512'] })

    harness.settings.set('algorithms', ['sha384'])
    await expect(callSync(harness, 'hash-config', {})).resolves.toEqual({ algorithms: ['sha256'] })
  })

  it('空算法/未知算法 → INVALID_PAYLOAD', async () => {
    const harness = createContext()
    registerHash(harness.ctx, createDeps())

    await expect(callSync(harness, 'hash-set-config', { algorithms: [] })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
    await expect(
      callSync(harness, 'hash-set-config', { algorithms: ['sha384'] })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
  })
})

describe('hash', () => {
  it('记忆算法，并把请求交给 worker（含超时与取消信号）', async () => {
    const harness = createContext()
    const deps = createDeps()
    registerHash(harness.ctx, deps)
    const controller = new AbortController()

    const result = await callTask(
      harness,
      'hash',
      { paths: ['C:\\a.txt'], algorithms: ['md5', 'sha256'] },
      controller.signal
    )

    expect(result).toEqual(EMPTY_RESULT)
    expect(deps.runs).toHaveLength(1)
    expect(deps.runs[0]).toMatchObject({
      workerPath: 'C:\\fake\\hash.worker.js',
      payload: { paths: ['C:\\a.txt'], algorithms: ['md5', 'sha256'] },
      timeoutMs: HASH_TIMEOUT_MS,
      signal: controller.signal
    })
    expect(harness.settings.get('algorithms')).toEqual(['md5', 'sha256'])
  })

  it('入参非法 → INVALID_PAYLOAD 且不启动 worker', async () => {
    const harness = createContext()
    const deps = createDeps()
    registerHash(harness.ctx, deps)

    await expect(callTask(harness, 'hash', { paths: [], algorithms: ['sha256'] })).rejects.toMatchObject(
      { code: 'INVALID_PAYLOAD' }
    )
    expect(deps.runs).toHaveLength(0)
  })

  it('worker 超时/崩溃 → FH_HASH_FAILED；结构化错误透传', async () => {
    const timeout = createContext()
    registerHash(timeout.ctx, createDeps(new TaskTimeoutError(1000)))
    await expect(
      callTask(timeout, 'hash', { paths: ['C:\\a'], algorithms: ['sha256'] })
    ).rejects.toMatchObject({ code: 'FH_HASH_FAILED' })

    const crash = createContext()
    registerHash(
      crash.ctx,
      createDeps(new TaskCrashError('worker crashed', new Error('out of memory')))
    )
    await expect(
      callTask(crash, 'hash', { paths: ['C:\\a'], algorithms: ['sha256'] })
    ).rejects.toMatchObject({ code: 'FH_HASH_FAILED', detail: 'out of memory' })

    const structured = createContext()
    registerHash(
      structured.ctx,
      createDeps({ code: 'FH_FILE_INVALID', message: '无法读取文件' })
    )
    await expect(
      callTask(structured, 'hash', { paths: ['C:\\a'], algorithms: ['sha256'] })
    ).rejects.toMatchObject({ code: 'FH_FILE_INVALID' })
  })

  it('mapHashWorkerError：非任务类错误原样返回', () => {
    const plain = new Error('plain')
    expect(mapHashWorkerError(plain)).toBe(plain)
    expect(mapHashWorkerError(new TaskCrashError('crashed', 'string-cause'))).toMatchObject({
      code: 'FH_HASH_FAILED',
      detail: 'string-cause'
    })
    expect(mapHashWorkerError(new TaskCrashError('crashed'))).toMatchObject({
      code: 'FH_HASH_FAILED',
      detail: 'crashed'
    })
  })
})

describe('createHashDeps', () => {
  it('暴露 node-kit 运行器（worker 路径由 electron-vite ?modulePath 注入）', () => {
    const deps = createHashDeps()
    expect(typeof deps.run).toBe('function')
  })
})
