/**
 * @file node.test.ts node.ts 单测（假 deps 注入，不触真实 worker/磁盘）
 * @author cuilanchao
 * @date 2026-11-20
 * @description watermark-config/watermark-set-output-dir 同步行为 + watermark 预检分类/目录解析/错误映射
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
import { mapWorkerError, registerWith, type ImageWatermarkDeps } from './node'
import { MAX_IMAGE_BYTES, MAX_WATERMARK_BYTES, type WatermarkPayload } from './schema'

interface HarnessOptions {
  result?: unknown
  checkReadable?: (path: string) => Promise<void>
  checkExclusive?: (path: string) => Promise<void>
  statSize?: (path: string) => Promise<number>
  makeDirError?: unknown
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

function errnoError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

function createHarness(options: HarnessOptions = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-iw-test-'))
  roots.push(root)
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const calls: RunTaskOptions<unknown>[] = []
  const updates: TaskUpdate[] = []

  const deps: ImageWatermarkDeps = {
    workerPath: join(root, 'watermark.worker.js'),
    run: <P, R>(runOptions: RunTaskOptions<P>): Promise<R> => {
      calls.push(runOptions as RunTaskOptions<unknown>)
      if (options.runError !== undefined) return Promise.reject(options.runError)
      return Promise.resolve(options.result as R)
    },
    checkReadable: options.checkReadable ?? (() => Promise.resolve()),
    checkExclusive: options.checkExclusive ?? (() => Promise.resolve()),
    statSize: options.statSize ?? (() => Promise.resolve(1024)),
    makeDir: async () => {
      if (options.makeDirError !== undefined) throw options.makeDirError
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

function payload(overrides: Partial<WatermarkPayload> = {}): WatermarkPayload {
  return {
    inputPaths: ['C:\\imgs\\a.png'],
    watermark: {
      type: 'text',
      text: '内部资料',
      color: '#ffffff',
      sizePct: 8,
      opacity: 30,
      rotation: 0,
      position: 'bottom-right',
      marginPct: 3,
      tile: false
    },
    ...overrides
  }
}

describe('watermark-config / watermark-set-output-dir', () => {
  it('缺省返回 userData/image-watermark', async () => {
    const harness = createHarness()
    await expect(invokeIpc(harness, 'watermark-config', {})).resolves.toEqual({
      outputDir: join(harness.root, 'userData', 'image-watermark')
    })
  })

  it('已记忆则返回记忆目录', async () => {
    const harness = createHarness()
    harness.settings.set('watermarkOutputDir', 'D:\\out')
    await expect(invokeIpc(harness, 'watermark-config', {})).resolves.toEqual({
      outputDir: 'D:\\out'
    })
  })

  it('设置目录成功后写 settings 并回包', async () => {
    const harness = createHarness()
    await expect(
      invokeIpc(harness, 'watermark-set-output-dir', { outputDir: 'D:\\out' })
    ).resolves.toEqual({ outputDir: 'D:\\out' })
    expect(harness.settings.get('watermarkOutputDir')).toBe('D:\\out')
  })

  it('空目录 → IW_INVALID_PAYLOAD；建目录失败 → IW_OUTPUT_DIR_INVALID', async () => {
    await expect(
      invokeIpc(createHarness(), 'watermark-set-output-dir', { outputDir: '' })
    ).rejects.toMatchObject({ code: 'IW_INVALID_PAYLOAD' })
    await expect(
      invokeIpc(createHarness({ makeDirError: errnoError('EACCES') }), 'watermark-set-output-dir', {
        outputDir: 'D:\\out'
      })
    ).rejects.toMatchObject({ code: 'IW_OUTPUT_DIR_INVALID', detail: 'EACCES' })
  })
})

describe('watermark 任务', () => {
  it('正常入参 → run 收到解析后的输出目录，result 原样回传', async () => {
    const result = { outputs: ['D:\\out\\a_水印.png'], failures: [] }
    const harness = createHarness({ result })
    harness.settings.set('watermarkOutputDir', 'D:\\out')
    await expect(runTask(harness, 'watermark', payload())).resolves.toEqual(result)
    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.payload).toEqual({
      inputPaths: ['C:\\imgs\\a.png'],
      watermark: payload().watermark,
      outputDir: 'D:\\out'
    })
    expect(harness.calls[0]?.timeoutMs).toBe(600_000)
  })

  it('请求指定目录优先于记忆目录', async () => {
    const harness = createHarness({ result: { outputs: [], failures: [] } })
    harness.settings.set('watermarkOutputDir', 'D:\\saved')
    await runTask(harness, 'watermark', payload({ outputDir: 'E:\\chosen' }))
    expect(harness.calls[0]?.payload).toMatchObject({ outputDir: 'E:\\chosen' })
  })

  it('非法入参 → IW_INVALID_PAYLOAD', async () => {
    await expect(runTask(createHarness(), 'watermark', {})).rejects.toMatchObject({
      code: 'IW_INVALID_PAYLOAD'
    })
  })

  it('输入不存在 → IW_INPUT_INVALID；占用 → IW_FILE_LOCKED', async () => {
    await expect(
      runTask(
        createHarness({ checkReadable: () => Promise.reject(errnoError('ENOENT')) }),
        'watermark',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IW_INPUT_INVALID', detail: 'ENOENT' })
    await expect(
      runTask(
        createHarness({ checkExclusive: () => Promise.reject(errnoError('EBUSY')) }),
        'watermark',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IW_FILE_LOCKED', detail: 'EBUSY' })
  })

  it('图片超限 → IW_IMAGE_TOO_LARGE', async () => {
    await expect(
      runTask(
        createHarness({ statSize: () => Promise.resolve(MAX_IMAGE_BYTES + 1) }),
        'watermark',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IW_IMAGE_TOO_LARGE' })
  })

  it('水印图片缺失 → IW_WATERMARK_MISSING；超限 → IW_WATERMARK_INVALID', async () => {
    const imagePayload = payload({
      watermark: {
        type: 'image',
        watermarkPath: 'C:\\logo.png',
        sizePct: 20,
        opacity: 50,
        rotation: 0,
        position: 'center',
        marginPct: 0,
        tile: false
      }
    })
    await expect(
      runTask(
        createHarness({
          checkReadable: (path) =>
            path.endsWith('logo.png') ? Promise.reject(errnoError('ENOENT')) : Promise.resolve()
        }),
        'watermark',
        imagePayload
      )
    ).rejects.toMatchObject({ code: 'IW_WATERMARK_MISSING' })
    await expect(
      runTask(
        createHarness({
          statSize: (path) =>
            Promise.resolve(path.endsWith('logo.png') ? MAX_WATERMARK_BYTES + 1 : 1024)
        }),
        'watermark',
        imagePayload
      )
    ).rejects.toMatchObject({ code: 'IW_WATERMARK_INVALID' })
  })

  it('输出目录不可建 → IW_OUTPUT_DIR_INVALID', async () => {
    await expect(
      runTask(createHarness({ makeDirError: errnoError('EPERM') }), 'watermark', payload())
    ).rejects.toMatchObject({ code: 'IW_OUTPUT_DIR_INVALID', detail: 'EPERM' })
  })

  it('worker 超时/崩溃映射', async () => {
    await expect(
      runTask(createHarness({ runError: new TaskTimeoutError(1000) }), 'watermark', payload())
    ).rejects.toMatchObject({ code: 'OP_TIMEOUT' })
    await expect(
      runTask(
        createHarness({ runError: new TaskCrashError('worker exited', new Error('boom')) }),
        'watermark',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IW_PROCESS_FAILED', detail: 'boom' })
  })

  it('mapWorkerError 透传结构化错误与非崩溃异常', () => {
    expect(mapWorkerError(new TaskCrashError('crashed'))).toMatchObject({
      code: 'IW_PROCESS_FAILED'
    })
    const structured = { code: 'IW_IMAGE_CORRUPT', message: '图片无法解码，可能已损坏' }
    expect(mapWorkerError(structured)).toBe(structured)
    const plain = new Error('plain')
    expect(mapWorkerError(plain)).toBe(plain)
  })
})
