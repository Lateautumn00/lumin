/**
 * @file node.test.ts node.ts 单测（假 deps 注入，不触真实 worker/磁盘）
 * @author cuilanchao
 * @date 2026-11-20
 * @description config/set-config 同步行为 + scan 记忆/校验/错误映射/注册入口
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'

import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  createNodeDeps,
  mapWorkerError,
  registerMain,
  registerWith,
  SCAN_TIMEOUT_MS,
  type DiskAnalyzerDeps
} from './node'
import type { ExportCsvPayload, ScanPayload } from './schema'

interface HarnessOptions {
  result?: unknown
  runError?: unknown
  /** 模拟写盘失败 */
  writeError?: unknown
}

interface Harness {
  ipc: Map<string, IpcHandler<unknown, unknown>>
  tasks: Map<string, TaskHandler<unknown, unknown>>
  settings: Map<string, unknown>
  calls: RunTaskOptions<unknown>[]
  updates: TaskUpdate[]
  written: { target: string; data: string }[]
  root: string
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createHarness(options: HarnessOptions = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-da-test-'))
  roots.push(root)
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const calls: RunTaskOptions<unknown>[] = []
  const updates: TaskUpdate[] = []
  const written: { target: string; data: string }[] = []

  const deps: DiskAnalyzerDeps = {
    scanWorkerPath: join(root, 'scan.worker.js'),
    run: <P, R>(runOptions: RunTaskOptions<P>): Promise<R> => {
      calls.push(runOptions as RunTaskOptions<unknown>)
      if (options.runError !== undefined) return Promise.reject(options.runError)
      return Promise.resolve(options.result as R)
    },
    writeFile: (target, data) => {
      if (options.writeError !== undefined) throw options.writeError
      written.push({ target, data })
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
  return { ipc, tasks, settings, calls, updates, written, root }
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

function payload(overrides: Partial<ScanPayload> = {}): ScanPayload {
  return { root: 'C:\\卷', minFileBytes: 1024, ...overrides }
}

describe('config / set-config', () => {
  it('缺省返回 null 目录与 0 阈值', async () => {
    await expect(invokeIpc(createHarness(), 'config', {})).resolves.toEqual({
      root: null,
      minFileBytes: 0
    })
  })

  it('已记忆则返回原值', async () => {
    const harness = createHarness()
    harness.settings.set('lastRoot', 'D:\\data')
    harness.settings.set('minFileBytes', 1024)
    await expect(invokeIpc(harness, 'config', {})).resolves.toEqual({
      root: 'D:\\data',
      minFileBytes: 1024
    })
  })

  it('非法存量回落默认（空串/类型错误/负数）', async () => {
    const harness = createHarness()
    harness.settings.set('lastRoot', '')
    harness.settings.set('minFileBytes', -5)
    await expect(invokeIpc(harness, 'config', {})).resolves.toEqual({
      root: null,
      minFileBytes: 0
    })
    harness.settings.set('lastRoot', 42)
    harness.settings.set('minFileBytes', 'x')
    await expect(invokeIpc(harness, 'config', {})).resolves.toEqual({
      root: null,
      minFileBytes: 0
    })
  })

  it('set-config 写入目录与阈值并回包', async () => {
    const harness = createHarness()
    await expect(
      invokeIpc(harness, 'set-config', { root: 'D:\\data', minFileBytes: 102400 })
    ).resolves.toEqual({ root: 'D:\\data', minFileBytes: 102400 })
    expect(harness.settings.get('lastRoot')).toBe('D:\\data')
    expect(harness.settings.get('minFileBytes')).toBe(102400)
  })

  it('set-config 省略 root 时保留上次目录；空串清空', async () => {
    const harness = createHarness()
    harness.settings.set('lastRoot', 'D:\\old')
    await expect(invokeIpc(harness, 'set-config', { minFileBytes: 0 })).resolves.toEqual({
      root: 'D:\\old',
      minFileBytes: 0
    })
    await expect(
      invokeIpc(harness, 'set-config', { root: '', minFileBytes: 0 })
    ).resolves.toEqual({ root: null, minFileBytes: 0 })
  })

  it('非法入参 → DA_INVALID_PAYLOAD', async () => {
    await expect(invokeIpc(createHarness(), 'set-config', {})).rejects.toMatchObject({
      code: 'DA_INVALID_PAYLOAD'
    })
  })
})

describe('scan 任务', () => {
  it('正常入参 → run 收到 payload/超时/workerPath，result 原样回传并记忆参数', async () => {
    const result = {
      root: 'C:\\卷',
      entries: [],
      totalBytes: 0,
      fileCount: 0,
      dirCount: 0,
      skipped: 0,
      elapsedMs: 1
    }
    const harness = createHarness({ result })
    await expect(runTask(harness, 'scan', payload())).resolves.toEqual(result)
    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.payload).toEqual(payload())
    expect(harness.calls[0]?.timeoutMs).toBe(SCAN_TIMEOUT_MS)
    expect(harness.calls[0]?.workerPath).toBe(join(harness.root, 'scan.worker.js'))
    expect(harness.settings.get('lastRoot')).toBe('C:\\卷')
    expect(harness.settings.get('minFileBytes')).toBe(1024)
  })

  it('非法入参 → DA_INVALID_PAYLOAD（不触 run）', async () => {
    const harness = createHarness()
    await expect(runTask(harness, 'scan', {})).rejects.toMatchObject({
      code: 'DA_INVALID_PAYLOAD'
    })
    await expect(runTask(harness, 'scan', payload({ minFileBytes: -1 }))).rejects.toMatchObject({
      code: 'DA_INVALID_PAYLOAD'
    })
    expect(harness.calls).toHaveLength(0)
  })

  it('worker 超时/崩溃映射为 DA_SCAN_FAILED', async () => {
    await expect(
      runTask(createHarness({ runError: new TaskTimeoutError(1000) }), 'scan', payload())
    ).rejects.toMatchObject({ code: 'DA_SCAN_FAILED' })
    await expect(
      runTask(
        createHarness({ runError: new TaskCrashError('worker exited', new Error('worker died')) }),
        'scan',
        payload()
      )
    ).rejects.toMatchObject({ code: 'DA_SCAN_FAILED', detail: 'worker died' })
  })

  it('结构化错误原样透传', () => {
    const error = { code: 'DA_ROOT_INVALID', message: '无法读取扫描目录' }
    expect(mapWorkerError(error)).toBe(error)
  })
})

describe('export-csv', () => {
  const TARGET = 'C:\\out\\x.csv'

  function exportPayload(): ExportCsvPayload {
    return {
      root: 'C:\\root',
      targetPath: TARGET,
      entries: [{ name: 'a.txt', path: 'C:\\root\\a.txt', kind: 'file', size: 10, fileCount: 0 }],
      typeStats: [{ ext: 'txt', files: 1, bytes: 10 }]
    }
  }

  it('正常导出：写入 BOM + CSV 并回传路径', async () => {
    const harness = createHarness()
    await expect(invokeIpc(harness, 'export-csv', exportPayload())).resolves.toEqual({
      path: TARGET
    })
    expect(harness.written).toHaveLength(1)
    expect(harness.written[0]?.target).toBe(TARGET)
    expect(harness.written[0]?.data.startsWith('\uFEFF# 磁盘空间分析')).toBe(true)
    expect(harness.written[0]?.data).toContain('文件,a.txt,a.txt,10,')
  })

  it('写盘失败 → DA_EXPORT_FAILED', async () => {
    const harness = createHarness({ writeError: new Error('EACCES') })
    await expect(invokeIpc(harness, 'export-csv', exportPayload())).rejects.toMatchObject({
      code: 'DA_EXPORT_FAILED',
      detail: 'EACCES'
    })
  })

  it('非法入参（缺目标路径）→ DA_INVALID_PAYLOAD', async () => {
    await expect(
      invokeIpc(createHarness(), 'export-csv', { root: 'C:\\root', entries: [], typeStats: [] })
    ).rejects.toMatchObject({ code: 'DA_INVALID_PAYLOAD' })
  })
})

describe('生产 deps 与注册入口', () => {
  it('createNodeDeps 暴露 worker 运行器与 CSV 写盘依赖', () => {
    const deps = createNodeDeps()
    expect(typeof deps.run).toBe('function')
    expect(typeof deps.writeFile).toBe('function')
  })

  it('registerMain 注册 config/set-config/export-csv/scan 四通道', () => {
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
    expect(seenIpc).toEqual(['config', 'set-config', 'export-csv'])
    expect(seenTask).toEqual(['scan'])
  })
})
