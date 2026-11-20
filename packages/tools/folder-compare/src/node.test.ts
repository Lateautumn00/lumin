/**
 * @file node.test.ts node.ts 单测（假 deps 注入，不触真实 worker/磁盘）
 * @author cuilanchao
 * @date 2026-11-20
 * @description config/set-config 同步行为 + compare 记忆/校验/错误映射/注册入口
 */
import { mkdtempSync, rmSync } from 'node:fs'
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
import {
  COMPARE_TIMEOUT_MS,
  createNodeDeps,
  mapWorkerError,
  registerMain,
  registerWith,
  type FolderCompareDeps
} from './node'
import type { ComparePayload } from './schema'

interface HarnessOptions {
  result?: unknown
  runError?: unknown
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

function createHarness(options: HarnessOptions = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-fc-test-'))
  roots.push(root)
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const calls: RunTaskOptions<unknown>[] = []
  const updates: TaskUpdate[] = []

  const deps: FolderCompareDeps = {
    compareWorkerPath: join(root, 'compare.worker.js'),
    run: <P, R>(runOptions: RunTaskOptions<P>): Promise<R> => {
      calls.push(runOptions as RunTaskOptions<unknown>)
      if (options.runError !== undefined) return Promise.reject(options.runError)
      return Promise.resolve(options.result as R)
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

function invokeIpc(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  return Promise.resolve(mustGet(harness.ipc, action)({ toolId: manifest.id, action, payload }))
}

function runTask(harness: Harness, action: string, payload: unknown): Promise<unknown> {
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

function payload(overrides: Partial<ComparePayload> = {}): ComparePayload {
  return { leftRoot: 'C:\\左', rightRoot: 'D:\\右', compareMtime: true, ...overrides }
}

describe('config / set-config', () => {
  it('缺省返回 null 目录与默认比较开关', async () => {
    await expect(invokeIpc(createHarness(), 'config', {})).resolves.toEqual({
      leftRoot: null,
      rightRoot: null,
      compareMtime: true
    })
  })

  it('已记忆则返回原值', async () => {
    const harness = createHarness()
    harness.settings.set('leftRoot', 'C:\\左')
    harness.settings.set('rightRoot', 'D:\\右')
    harness.settings.set('compareMtime', false)
    await expect(invokeIpc(harness, 'config', {})).resolves.toEqual({
      leftRoot: 'C:\\左',
      rightRoot: 'D:\\右',
      compareMtime: false
    })
  })

  it('非法存量回落默认（空串/类型错误/非布尔）', async () => {
    const harness = createHarness()
    harness.settings.set('leftRoot', '')
    harness.settings.set('rightRoot', 42)
    harness.settings.set('compareMtime', 'x')
    await expect(invokeIpc(harness, 'config', {})).resolves.toEqual({
      leftRoot: null,
      rightRoot: null,
      compareMtime: true
    })
  })

  it('set-config 写入目录与开关并回包', async () => {
    const harness = createHarness()
    await expect(
      invokeIpc(harness, 'set-config', {
        leftRoot: 'C:\\左',
        rightRoot: 'D:\\右',
        compareMtime: false
      })
    ).resolves.toEqual({ leftRoot: 'C:\\左', rightRoot: 'D:\\右', compareMtime: false })
    expect(harness.settings.get('leftRoot')).toBe('C:\\左')
    expect(harness.settings.get('rightRoot')).toBe('D:\\右')
    expect(harness.settings.get('compareMtime')).toBe(false)
  })

  it('set-config 省略目录时保留上次；空串清空', async () => {
    const harness = createHarness()
    harness.settings.set('leftRoot', 'C:\\old')
    harness.settings.set('rightRoot', 'D:\\old')
    await expect(invokeIpc(harness, 'set-config', { compareMtime: true })).resolves.toEqual({
      leftRoot: 'C:\\old',
      rightRoot: 'D:\\old',
      compareMtime: true
    })
    await expect(
      invokeIpc(harness, 'set-config', { leftRoot: '', rightRoot: '', compareMtime: true })
    ).resolves.toEqual({ leftRoot: null, rightRoot: null, compareMtime: true })
  })

  it('非法入参 → FC_INVALID_PAYLOAD', async () => {
    await expect(invokeIpc(createHarness(), 'set-config', {})).rejects.toMatchObject({
      code: 'FC_INVALID_PAYLOAD'
    })
  })
})

describe('compare 任务', () => {
  it('正常入参 → run 收到 payload/超时/workerPath，result 原样回传并记忆参数', async () => {
    const result = {
      leftRoot: 'C:\\左',
      rightRoot: 'D:\\右',
      entries: [],
      onlyLeft: 0,
      onlyRight: 0,
      different: 0,
      same: 0,
      leftFiles: 0,
      rightFiles: 0,
      skipped: 0,
      truncated: 0,
      compareMtime: true,
      elapsedMs: 1
    }
    const harness = createHarness({ result })
    await expect(runTask(harness, 'compare', payload())).resolves.toEqual(result)
    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.payload).toEqual(payload())
    expect(harness.calls[0]?.timeoutMs).toBe(COMPARE_TIMEOUT_MS)
    expect(harness.calls[0]?.workerPath).toBe(join(harness.root, 'compare.worker.js'))
    expect(harness.settings.get('leftRoot')).toBe('C:\\左')
    expect(harness.settings.get('rightRoot')).toBe('D:\\右')
    expect(harness.settings.get('compareMtime')).toBe(true)
  })

  it('非法入参 → FC_INVALID_PAYLOAD（不触 run）', async () => {
    const harness = createHarness()
    await expect(runTask(harness, 'compare', {})).rejects.toMatchObject({
      code: 'FC_INVALID_PAYLOAD'
    })
    await expect(
      runTask(harness, 'compare', payload({ rightRoot: '' }))
    ).rejects.toMatchObject({ code: 'FC_INVALID_PAYLOAD' })
    expect(harness.calls).toHaveLength(0)
  })

  it('worker 超时/崩溃映射为 FC_COMPARE_FAILED', async () => {
    await expect(
      runTask(createHarness({ runError: new TaskTimeoutError(1000) }), 'compare', payload())
    ).rejects.toMatchObject({ code: 'FC_COMPARE_FAILED' })
    await expect(
      runTask(
        createHarness({ runError: new TaskCrashError('worker exited', new Error('worker died')) }),
        'compare',
        payload()
      )
    ).rejects.toMatchObject({ code: 'FC_COMPARE_FAILED', detail: 'worker died' })
  })

  it('结构化错误原样透传', () => {
    const error = { code: 'FC_ROOT_INVALID', message: '无法读取对比目录' }
    expect(mapWorkerError(error)).toBe(error)
  })
})

describe('生产 deps 与注册入口', () => {
  it('createNodeDeps 暴露 worker 运行器', () => {
    const deps = createNodeDeps()
    expect(typeof deps.run).toBe('function')
  })

  it('registerMain 注册 config/set-config/compare 三通道', () => {
    const seenIpc: string[] = []
    const seenTask: string[] = []
    const ctx = {
      toolId: manifest.id,
      manifest,
      registerIpc: (action: string) => seenIpc.push(action),
      registerTask: (action: string) => seenTask.push(action),
      settings: { get: async (_key: string, fallback: never) => fallback, set: async () => undefined },
      log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
      paths: { temp: '', userData: '', binaries: '' }
    } as unknown as MainPluginContext
    registerMain(ctx)
    expect(seenIpc).toEqual(['config', 'set-config'])
    expect(seenTask).toEqual(['compare'])
  })
})
