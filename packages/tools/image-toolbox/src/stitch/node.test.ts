/**
 * @file node.test.ts node.ts 单测（假 deps 注入，不触真实 worker/磁盘）
 * @author cuilanchao
 * @date 2026-11-20
 * @description config/set-output-dir 同步行为 + stitch 预检分类/目录解析/错误映射
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
import { createNodeDeps, mapWorkerError, registerWith, type ImageStitchDeps } from './node'
import { MAX_IMAGE_BYTES, type SplitPayload, type StitchPayload } from './schema'

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
  const root = mkdtempSync(join(tmpdir(), 'lumin-is-test-'))
  roots.push(root)
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const calls: RunTaskOptions<unknown>[] = []
  const updates: TaskUpdate[] = []

  const deps: ImageStitchDeps = {
    workerPath: join(root, 'stitch.worker.js'),
    splitWorkerPath: join(root, 'split.worker.js'),
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

function payload(overrides: Partial<StitchPayload> = {}): StitchPayload {
  return {
    inputPaths: ['C:\\imgs\\a.png'],
    layout: {
      mode: 'vertical',
      sizeMode: 'first',
      fixedSize: 2000,
      columns: 3,
      gutter: 12,
      padding: 0
    },
    encoder: 'png',
    quality: 90,
    bgColor: '#ffffff',
    ...overrides
  }
}

describe('config / set-output-dir', () => {
  it('缺省返回 userData/image-stitch', async () => {
    const harness = createHarness()
    await expect(invokeIpc(harness, 'stitch-config', {})).resolves.toEqual({
      outputDir: join(harness.root, 'userData', 'image-stitch')
    })
  })

  it('已记忆则返回记忆目录', async () => {
    const harness = createHarness()
    harness.settings.set('stitchOutputDir', 'D:\\out')
    await expect(invokeIpc(harness, 'stitch-config', {})).resolves.toEqual({ outputDir: 'D:\\out' })
  })

  it('设置目录成功后写 settings 并回包', async () => {
    const harness = createHarness()
    await expect(
      invokeIpc(harness, 'stitch-set-output-dir', { outputDir: 'D:\\out' })
    ).resolves.toEqual({
      outputDir: 'D:\\out'
    })
    expect(harness.settings.get('stitchOutputDir')).toBe('D:\\out')
  })

  it('空目录 → IS_INVALID_PAYLOAD；建目录失败 → IS_OUTPUT_DIR_INVALID', async () => {
    await expect(
      invokeIpc(createHarness(), 'stitch-set-output-dir', { outputDir: '' })
    ).rejects.toMatchObject({ code: 'IS_INVALID_PAYLOAD' })
    await expect(
      invokeIpc(createHarness({ makeDirError: errnoError('EACCES') }), 'stitch-set-output-dir', {
        outputDir: 'D:\\out'
      })
    ).rejects.toMatchObject({ code: 'IS_OUTPUT_DIR_INVALID', detail: 'EACCES' })
  })
})

describe('stitch 任务', () => {
  it('正常入参 → run 收到解析后的输出目录与超时，result 原样回传', async () => {
    const result = {
      outputPath: 'D:\\out\\拼接_20261120-090503.png',
      width: 300,
      height: 200,
      count: 1
    }
    const harness = createHarness({ result })
    harness.settings.set('stitchOutputDir', 'D:\\out')
    await expect(runTask(harness, 'stitch', payload())).resolves.toEqual(result)
    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.payload).toEqual({
      inputPaths: ['C:\\imgs\\a.png'],
      layout: payload().layout,
      encoder: 'png',
      quality: 90,
      bgColor: '#ffffff',
      outputDir: 'D:\\out'
    })
    expect(harness.calls[0]?.timeoutMs).toBe(600_000)
    expect(harness.calls[0]?.workerPath).toBe(join(harness.root, 'stitch.worker.js'))
  })

  it('请求指定目录优先于记忆目录', async () => {
    const harness = createHarness({ result: { outputPath: '', width: 1, height: 1, count: 1 } })
    harness.settings.set('stitchOutputDir', 'D:\\saved')
    await runTask(harness, 'stitch', payload({ outputDir: 'E:\\chosen' }))
    expect(harness.calls[0]?.payload).toMatchObject({ outputDir: 'E:\\chosen' })
  })

  it('非法入参 → IS_INVALID_PAYLOAD（不触 run）', async () => {
    const harness = createHarness()
    await expect(runTask(harness, 'stitch', {})).rejects.toMatchObject({
      code: 'IS_INVALID_PAYLOAD'
    })
    await expect(
      runTask(harness, 'stitch', payload({ inputPaths: ['C:\\imgs\\a.gif'] }))
    ).rejects.toMatchObject({ code: 'IS_INVALID_PAYLOAD' })
    expect(harness.calls).toHaveLength(0)
  })

  it('输入不存在 → IS_INPUT_INVALID；占用 → IS_FILE_LOCKED', async () => {
    await expect(
      runTask(
        createHarness({ checkReadable: () => Promise.reject(errnoError('ENOENT')) }),
        'stitch',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IS_INPUT_INVALID', detail: 'ENOENT' })
    await expect(
      runTask(
        createHarness({ checkExclusive: () => Promise.reject(errnoError('EBUSY')) }),
        'stitch',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IS_FILE_LOCKED', detail: 'EBUSY' })
  })

  it('读取其他错误归 IS_INPUT_INVALID（带技术尾行）', async () => {
    await expect(
      runTask(
        createHarness({ checkReadable: () => Promise.reject(new Error('boom')) }),
        'stitch',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IS_INPUT_INVALID', detail: 'boom' })
  })

  it('图片超限 → IS_IMAGE_TOO_LARGE', async () => {
    await expect(
      runTask(
        createHarness({ statSize: () => Promise.resolve(MAX_IMAGE_BYTES + 1) }),
        'stitch',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IS_IMAGE_TOO_LARGE' })
  })

  it('尺寸读取失败（EPERM）→ 归文件占用', async () => {
    await expect(
      runTask(
        createHarness({ statSize: () => Promise.reject(errnoError('EPERM')) }),
        'stitch',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IS_FILE_LOCKED', detail: 'EPERM' })
  })

  it('输出目录不可建 → IS_OUTPUT_DIR_INVALID', async () => {
    await expect(
      runTask(createHarness({ makeDirError: errnoError('EPERM') }), 'stitch', payload())
    ).rejects.toMatchObject({ code: 'IS_OUTPUT_DIR_INVALID', detail: 'EPERM' })
  })

  it('worker 超时/崩溃映射', async () => {
    await expect(
      runTask(createHarness({ runError: new TaskTimeoutError(1000) }), 'stitch', payload())
    ).rejects.toMatchObject({ code: 'OP_TIMEOUT' })
    await expect(
      runTask(
        createHarness({ runError: new TaskCrashError('worker exited', new Error('worker died')) }),
        'stitch',
        payload()
      )
    ).rejects.toMatchObject({ code: 'IS_PROCESS_FAILED', detail: 'worker died' })
  })

  it('结构化错误原样透传', () => {
    const error = { code: 'IS_WRITE_FAILED', message: '写入失败' }
    expect(mapWorkerError(error)).toBe(error)
  })
})

function splitPayload(overrides: Partial<SplitPayload> = {}): SplitPayload {
  return {
    inputPath: 'C:\\imgs\\long.png',
    mode: 'height',
    height: 1000,
    parts: 3,
    quality: 90,
    ...overrides
  }
}

describe('split 任务（M40）', () => {
  it('正常入参 → 记忆目录解析 + 参数透传 + 独立 worker', async () => {
    const result = {
      outputs: [{ path: 'D:\\out\\long_part01.png', width: 800, height: 1000 }],
      sourceWidth: 800,
      sourceHeight: 1000
    }
    const harness = createHarness({ result })
    harness.settings.set('stitchOutputDir', 'D:\\out')
    await expect(runTask(harness, 'split', splitPayload())).resolves.toEqual(result)
    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.payload).toEqual({
      inputPath: 'C:\\imgs\\long.png',
      mode: 'height',
      height: 1000,
      parts: 3,
      quality: 90,
      outputDir: 'D:\\out'
    })
    expect(harness.calls[0]?.workerPath).toBe(join(harness.root, 'split.worker.js'))
  })

  it('非法入参（扩展名/份数/高度越界）→ IS_INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expect(
      runTask(harness, 'split', splitPayload({ inputPath: 'C:\\imgs\\a.gif' }))
    ).rejects.toMatchObject({ code: 'IS_INVALID_PAYLOAD' })
    await expect(runTask(harness, 'split', splitPayload({ parts: 1 }))).rejects.toMatchObject({
      code: 'IS_INVALID_PAYLOAD'
    })
    await expect(runTask(harness, 'split', splitPayload({ height: 10 }))).rejects.toMatchObject({
      code: 'IS_INVALID_PAYLOAD'
    })
    expect(harness.calls).toHaveLength(0)
  })

  it('输入缺失 → IS_INPUT_INVALID；体积超限 → IS_IMAGE_TOO_LARGE', async () => {
    await expect(
      runTask(
        createHarness({ checkReadable: () => Promise.reject(errnoError('ENOENT')) }),
        'split',
        splitPayload()
      )
    ).rejects.toMatchObject({ code: 'IS_INPUT_INVALID', detail: 'ENOENT' })
    await expect(
      runTask(
        createHarness({ statSize: () => Promise.resolve(MAX_IMAGE_BYTES + 1) }),
        'split',
        splitPayload()
      )
    ).rejects.toMatchObject({ code: 'IS_IMAGE_TOO_LARGE' })
  })
})

describe('生产 deps 与注册入口', () => {
  it('createNodeDeps 真实 fs 实现可读/独占/体积/建目录', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumin-is-deps-'))
    roots.push(dir)
    const deps = createNodeDeps()
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'x')
    await expect(deps.checkReadable(file)).resolves.toBeUndefined()
    await expect(deps.checkExclusive(file)).resolves.toBeUndefined()
    await expect(deps.statSize(file)).resolves.toBe(1)
    const sub = join(dir, 'sub')
    await deps.makeDir(sub)
    expect(existsSync(sub)).toBe(true)
    await expect(deps.checkReadable(join(dir, 'nope.txt'))).rejects.toThrow()
    await expect(deps.statSize(join(dir, 'nope.txt'))).rejects.toThrow()
  })

  it('registerWith 注册 stitch-config/stitch-set-output-dir/stitch/split 四通道', () => {
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
    registerWith(ctx, createNodeDeps())
    expect(seenIpc).toEqual(['stitch-config', 'stitch-set-output-dir'])
    expect(seenTask).toEqual(['stitch', 'split'])
  })
})
