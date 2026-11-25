/**
 * @file node.test.ts node.ts 单测（假 deps 注入，不触真实 worker/磁盘）
 * @author cuilanchao
 * @date 2026-11-24
 * @description config/set-output-dir 同步行为 + dewatermark 预检分类/目录解析/错误映射
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { createNodeDeps, mapWorkerError, registerWith, type ImageDewatermarkDeps } from './node'
import { MAX_IMAGE_BYTES, type DewatermarkPayload } from './schema'

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
  ctx: MainPluginContext
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function errnoError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

function createHarness(options: HarnessOptions = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-idw-test-'))
  roots.push(root)
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const calls: RunTaskOptions<unknown>[] = []
  const updates: TaskUpdate[] = []

  const deps: ImageDewatermarkDeps = {
    workerPath: join(root, 'dewatermark.worker.js'),
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
  return { ipc, tasks, settings, calls, updates, root, ctx }
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

function payload(overrides: Partial<DewatermarkPayload> = {}): DewatermarkPayload {
  return {
    inputPath: 'C:\\imgs\\a.png',
    regions: [{ x: 10, y: 10, width: 20, height: 20 }],
    mode: 'inpaint',
    blurRadius: 12,
    ...overrides
  }
}

describe('config / set-output-dir', () => {
  it('缺省返回 userData/image-dewatermark', async () => {
    const harness = createHarness()
    await expect(invokeIpc(harness, 'dewatermark-config', {})).resolves.toEqual({
      outputDir: join(harness.root, 'userData', 'image-dewatermark')
    })
  })

  it('已记忆则返回记忆目录', async () => {
    const harness = createHarness()
    harness.settings.set('dewatermarkOutputDir', 'D:\\out')
    await expect(invokeIpc(harness, 'dewatermark-config', {})).resolves.toEqual({
      outputDir: 'D:\\out'
    })
  })

  it('设置目录成功后写 settings 并回包', async () => {
    const harness = createHarness()
    await expect(
      invokeIpc(harness, 'dewatermark-set-output-dir', { outputDir: 'D:\\out' })
    ).resolves.toEqual({
      outputDir: 'D:\\out'
    })
    expect(harness.settings.get('dewatermarkOutputDir')).toBe('D:\\out')
  })

  it('空目录 → IDW_INVALID_PAYLOAD；建目录失败 → IDW_OUTPUT_DIR_INVALID', async () => {
    await expect(
      invokeIpc(createHarness(), 'dewatermark-set-output-dir', { outputDir: '' })
    ).rejects.toMatchObject({ code: 'IDW_INVALID_PAYLOAD' })
    await expect(
      invokeIpc(
        createHarness({ makeDirError: errnoError('EACCES') }),
        'dewatermark-set-output-dir',
        {
          outputDir: 'D:\\out'
        }
      )
    ).rejects.toMatchObject({ code: 'IDW_OUTPUT_DIR_INVALID', detail: 'EACCES' })
  })
})

describe('dewatermark 任务', () => {
  it('正常入参 → run 收到解析后的输出目录与区域，result 原样回传', async () => {
    const result = { output: 'D:\\out\\a_去水印.png', warnings: [] }
    const harness = createHarness({ result })
    harness.settings.set('dewatermarkOutputDir', 'D:\\out')
    await expect(runTask(harness, 'dewatermark', payload())).resolves.toEqual(result)
    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.payload).toEqual({
      inputPath: 'C:\\imgs\\a.png',
      outputDir: 'D:\\out',
      regions: [{ x: 10, y: 10, width: 20, height: 20 }],
      mode: 'inpaint',
      blurRadius: 12
    })
    expect(harness.calls[0]?.timeoutMs).toBe(600_000)
  })

  it('请求指定目录优先于记忆目录', async () => {
    const harness = createHarness({ result: { output: 'E:\\chosen\\a.png', warnings: [] } })
    harness.settings.set('dewatermarkOutputDir', 'D:\\saved')
    await runTask(harness, 'dewatermark', payload({ outputDir: 'E:\\chosen' }))
    expect(harness.calls[0]?.payload).toMatchObject({ outputDir: 'E:\\chosen' })
  })

  it('非法入参 → IDW_INVALID_PAYLOAD', async () => {
    await expect(runTask(createHarness(), 'dewatermark', {})).rejects.toMatchObject({
      code: 'IDW_INVALID_PAYLOAD'
    })
  })

  it('输入不存在/占用/stat 失败 → 对应输入错误', async () => {
    await expect(
      runTask(
        createHarness({ checkReadable: () => Promise.reject(errnoError('ENOENT')) }),
        'dewatermark',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IDW_INPUT_INVALID', detail: 'ENOENT' })
    await expect(
      runTask(
        createHarness({ checkExclusive: () => Promise.reject(errnoError('EBUSY')) }),
        'dewatermark',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IDW_FILE_LOCKED', detail: 'EBUSY' })
    await expect(
      runTask(
        createHarness({ statSize: () => Promise.reject(errnoError('EACCES')) }),
        'dewatermark',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IDW_FILE_LOCKED', detail: 'EACCES' })
  })

  it('图片超限 → IDW_IMAGE_TOO_LARGE', async () => {
    await expect(
      runTask(
        createHarness({ statSize: () => Promise.resolve(MAX_IMAGE_BYTES + 1) }),
        'dewatermark',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IDW_IMAGE_TOO_LARGE' })
  })

  it('输出目录不可建 → IDW_OUTPUT_DIR_INVALID', async () => {
    await expect(
      runTask(createHarness({ makeDirError: errnoError('EPERM') }), 'dewatermark', payload())
    ).rejects.toMatchObject({ code: 'IDW_OUTPUT_DIR_INVALID', detail: 'EPERM' })
  })

  it('worker 超时/崩溃映射', async () => {
    await expect(
      runTask(createHarness({ runError: new TaskTimeoutError(1000) }), 'dewatermark', payload())
    ).rejects.toMatchObject({ code: 'OP_TIMEOUT' })
    await expect(
      runTask(
        createHarness({ runError: new TaskCrashError('worker exited', new Error('boom')) }),
        'dewatermark',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IDW_INPAINT_FAILED', detail: 'boom' })
  })

  it('非 errno / 未知 errno 的预检失败 → IDW_INPUT_INVALID', async () => {
    await expect(
      runTask(
        createHarness({ checkReadable: () => Promise.reject(new Error('weird failure')) }),
        'dewatermark',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IDW_INPUT_INVALID', detail: 'weird failure' })
    await expect(
      runTask(
        createHarness({ checkReadable: () => Promise.reject(errnoError('EUNKNOWN')) }),
        'dewatermark',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IDW_INPUT_INVALID', detail: 'EUNKNOWN' })
    await expect(
      runTask(
        createHarness({ checkReadable: () => Promise.reject('read boom') }),
        'dewatermark',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IDW_INPUT_INVALID', detail: 'read boom' })
  })

  it('mapWorkerError 透传结构化错误与非崩溃异常', () => {
    expect(mapWorkerError(new TaskCrashError('crashed'))).toMatchObject({
      code: 'IDW_INPAINT_FAILED'
    })
    const structured = { code: 'IDW_IMAGE_CORRUPT', message: '图片无法解码，可能已损坏' }
    expect(mapWorkerError(structured)).toBe(structured)
    const plain = new Error('plain')
    expect(mapWorkerError(plain)).toBe(plain)
  })
})

describe('生产依赖与注册入口', () => {
  it('createNodeDeps 真实预检/建目录可用', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lumin-idw-deps-'))
    roots.push(root)
    const deps = createNodeDeps()
    expect(typeof deps.run).toBe('function')
    const file = join(root, 'a.png')
    writeFileSync(file, 'x')
    await expect(deps.checkReadable(file)).resolves.toBeUndefined()
    await expect(deps.checkExclusive(file)).resolves.toBeUndefined()
    await expect(deps.statSize(file)).resolves.toBe(1)
    const dir = join(root, 'out')
    await deps.makeDir(dir)
    expect(existsSync(dir)).toBe(true)
  })

  it('registerWith 注册 dewatermark-config/dewatermark-set-output-dir/dewatermark', () => {
    const harness = createHarness()
    registerWith(harness.ctx, createNodeDeps())
    expect([...harness.ipc.keys()].sort()).toEqual([
      'dewatermark-config',
      'dewatermark-set-output-dir'
    ])
    expect([...harness.tasks.keys()]).toEqual(['dewatermark'])
  })
})
