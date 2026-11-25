/**
 * @file node.test.ts node.ts 单测（假 deps 注入，不触真实 worker/磁盘）
 * @author cuilanchao
 * @date 2026-11-20
 * @description config/set-config 同步行为 + pack/unpack 记忆/校验/错误映射/注册入口
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
import { manifest } from '../manifest'
import {
  ARCHIVE_TIMEOUT_MS,
  createNodeDeps,
  mapWorkerError,
  registerMain,
  registerWith,
  type ZipToolDeps
} from './node'
import type { PackPayload, UnpackPayload } from './schema'

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
  const root = mkdtempSync(join(tmpdir(), 'lumin-zip-node-'))
  roots.push(root)
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const calls: RunTaskOptions<unknown>[] = []
  const updates: TaskUpdate[] = []

  const deps: ZipToolDeps = {
    archiveWorkerPath: join(root, 'archive.worker.js'),
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

function packPayload(overrides: Partial<PackPayload> = {}): PackPayload {
  return {
    sources: ['C:\\素材\\a.txt'],
    outputDir: 'D:\\输出',
    outputName: '包.zip',
    ...overrides
  }
}

function unpackPayload(overrides: Partial<UnpackPayload> = {}): UnpackPayload {
  return { archive: 'C:\\包.zip', targetDir: 'D:\\解压', conflict: 'rename', ...overrides }
}

const PACK_RESULT = { outputZip: 'D:\\输出\\包.zip', files: 1, dirs: 0, bytes: 3, elapsedMs: 5 }
const UNPACK_RESULT = {
  targetDir: 'D:\\解压',
  files: 1,
  dirs: 0,
  bytes: 3,
  skipped: 0,
  renamed: 0,
  elapsedMs: 5
}

describe('config / set-config', () => {
  it('缺省返回打包模式与空记忆', async () => {
    await expect(invokeIpc(createHarness(), 'config', {})).resolves.toEqual({
      mode: 'pack',
      packSources: [],
      outputDir: null,
      outputName: null,
      archive: null,
      targetDir: null,
      conflict: 'rename'
    })
  })

  it('已记忆则返回原值；非法条目被过滤/回落', async () => {
    const harness = createHarness()
    harness.settings.set('mode', 'unpack')
    harness.settings.set('packSources', ['C:\\a', 42, ''])
    harness.settings.set('outputDir', '')
    harness.settings.set('outputName', 7)
    harness.settings.set('archive', 'C:\\包.zip')
    harness.settings.set('targetDir', 'D:\\解压')
    harness.settings.set('conflict', 'skip')
    await expect(invokeIpc(harness, 'config', {})).resolves.toEqual({
      mode: 'unpack',
      packSources: ['C:\\a', ''],
      outputDir: null,
      outputName: null,
      archive: 'C:\\包.zip',
      targetDir: 'D:\\解压',
      conflict: 'skip'
    })

    const fallback = createHarness()
    fallback.settings.set('mode', 'unknown')
    fallback.settings.set('packSources', '不是数组')
    fallback.settings.set('conflict', 'overwrite')
    await expect(invokeIpc(fallback, 'config', {})).resolves.toMatchObject({
      mode: 'pack',
      packSources: [],
      conflict: 'rename'
    })
  })

  it('set-config 写入全部记忆并回包', async () => {
    const harness = createHarness()
    const payload = {
      mode: 'pack',
      packSources: ['C:\\素材'],
      outputDir: 'D:\\输出',
      outputName: '包.zip',
      archive: null,
      targetDir: null,
      conflict: 'rename'
    }
    await expect(invokeIpc(harness, 'set-config', payload)).resolves.toEqual(payload)
    expect(harness.settings.get('packSources')).toEqual(['C:\\素材'])
    expect(harness.settings.get('outputName')).toBe('包.zip')
  })

  it('非法入参 → ZP_INVALID_PAYLOAD', async () => {
    await expect(invokeIpc(createHarness(), 'set-config', { mode: 'x' })).rejects.toMatchObject({
      code: 'ZP_INVALID_PAYLOAD'
    })
  })
})

describe('pack 任务', () => {
  it('正常入参 → run 收到 mode/payload/超时/workerPath，结果解析并记忆', async () => {
    const harness = createHarness({ result: PACK_RESULT })
    await expect(runTask(harness, 'pack', packPayload())).resolves.toEqual(PACK_RESULT)
    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.payload).toEqual({ mode: 'pack', payload: packPayload() })
    expect(harness.calls[0]?.timeoutMs).toBe(ARCHIVE_TIMEOUT_MS)
    expect(harness.calls[0]?.workerPath).toBe(join(harness.root, 'archive.worker.js'))
    expect(harness.settings.get('mode')).toBe('pack')
    expect(harness.settings.get('packSources')).toEqual(['C:\\素材\\a.txt'])
    expect(harness.settings.get('outputDir')).toBe('D:\\输出')
    expect(harness.settings.get('outputName')).toBe('包.zip')
    expect(harness.settings.get('archive')).toBeNull()
  })

  it('空源 / 含路径分隔符的文件名 → ZP_INVALID_PAYLOAD（不触 run）', async () => {
    const harness = createHarness()
    await expect(runTask(harness, 'pack', packPayload({ sources: [] }))).rejects.toMatchObject({
      code: 'ZP_INVALID_PAYLOAD'
    })
    await expect(
      runTask(harness, 'pack', packPayload({ outputName: '子目录/x.zip' }))
    ).rejects.toMatchObject({ code: 'ZP_INVALID_PAYLOAD' })
    expect(harness.calls).toHaveLength(0)
  })

  it('worker 超时/崩溃映射为 ZP_TASK_FAILED；结构化错误透传', async () => {
    await expect(
      runTask(createHarness({ runError: new TaskTimeoutError(1000) }), 'pack', packPayload())
    ).rejects.toMatchObject({ code: 'ZP_TASK_FAILED' })
    await expect(
      runTask(
        createHarness({ runError: new TaskCrashError('worker exited', new Error('worker died')) }),
        'pack',
        packPayload()
      )
    ).rejects.toMatchObject({ code: 'ZP_TASK_FAILED', detail: 'worker died' })

    const error = { code: 'ZP_ARCHIVE_INVALID', message: '不是 ZIP 文件' }
    expect(mapWorkerError(error)).toBe(error)
  })
})

describe('unpack 任务', () => {
  it('正常入参 → 结果解析并记忆解压参数', async () => {
    const harness = createHarness({ result: UNPACK_RESULT })
    await expect(runTask(harness, 'unpack', unpackPayload())).resolves.toEqual(UNPACK_RESULT)
    expect(harness.calls[0]?.payload).toEqual({ mode: 'unpack', payload: unpackPayload() })
    expect(harness.settings.get('mode')).toBe('unpack')
    expect(harness.settings.get('archive')).toBe('C:\\包.zip')
    expect(harness.settings.get('targetDir')).toBe('D:\\解压')
    expect(harness.settings.get('conflict')).toBe('rename')
    expect(harness.settings.get('packSources')).toEqual([])
  })

  it('非法冲突策略 → ZP_INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expect(
      runTask(harness, 'unpack', { ...unpackPayload(), conflict: 'overwrite' })
    ).rejects.toMatchObject({ code: 'ZP_INVALID_PAYLOAD' })
    expect(harness.calls).toHaveLength(0)
  })
})

describe('生产 deps 与注册入口', () => {
  it('createNodeDeps 暴露 worker 运行器', () => {
    const deps = createNodeDeps()
    expect(typeof deps.run).toBe('function')
  })

  it('registerMain 注册 config/set-config/pack/unpack 四通道', () => {
    const seenIpc: string[] = []
    const seenTask: string[] = []
    const ctx = {
      toolId: manifest.id,
      manifest,
      registerIpc: (action: string) => seenIpc.push(action),
      registerTask: (action: string) => seenTask.push(action),
      settings: {
        get: async (_key: string, fallback: never) => fallback,
        set: async () => undefined
      },
      log: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
      },
      paths: { temp: '', userData: '', binaries: '' }
    } as unknown as MainPluginContext
    registerMain(ctx)
    expect(seenIpc).toEqual(['config', 'set-config'])
    expect(seenTask).toEqual(['pack', 'unpack'])
  })
})
