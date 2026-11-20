/**
 * @file node.ts 单测（假 ctx/依赖，不依赖 Electron 与真实 OCR）
 * @author cuilanchao
 * @date 2026-11-20
 * @description recognize 预检/逐个失败不中断/结果同序与错误映射、export 两种模式与写盘失败、
 *              config 缺省与记忆（spec §5/§6）
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
import type { StructuredError, TaskUpdate } from '@lumin/shared'
import { toolError } from './errors'
import { manifest } from './manifest'
import {
  mapWorkerError,
  OP_TIMEOUT_MS,
  createNodeDeps,
  registerMain,
  registerWith,
  type BatchOcrDeps
} from './node'
import type { RecognizeRequest } from './recognize'
import type { RecognizeResult } from './schema'

const RESULT: RecognizeResult = {
  items: [
    { status: 'done', inputPath: 'C:\\图 片\\a.png', width: 100, height: 50, text: '你好' },
    { status: 'done', inputPath: 'C:\\图 片\\b.png', width: 100, height: 50, text: '世界' }
  ]
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
function createHarness(overrides: Partial<BatchOcrDeps> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-batch-ocr-'))
  roots.push(root)
  const userData = join(root, 'userData')
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const emitted: TaskUpdate[] = []
  const runs: RunTaskOptions<RecognizeRequest>[] = []

  const ctx = {
    toolId: 'batch-ocr',
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
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    paths: { temp: root, userData, binaries: root }
  }

  const deps: BatchOcrDeps = {
    workerPath: 'C:\\fake\\batch.worker.js',
    checkReadable: async () => undefined,
    checkExclusive: async () => undefined,
    statSize: async () => 1024,
    run: async (options) => {
      runs.push(options)
      options.onUpdate?.({ kind: 'progress', current: 1, total: 2, message: '识别…' })
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
  return {
    root,
    userData,
    ctx: ctx as unknown as MainPluginContext,
    ipc,
    tasks,
    settings,
    emitted,
    runs
  }
}

function handlerOf(harness: Harness, action: string): IpcHandler<unknown, unknown> {
  const handler = harness.ipc.get(action)
  if (handler === undefined) throw new Error(`未注册通道：${action}`)
  return handler
}

function invoke(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  return Promise.resolve(handlerOf(harness, action)({ toolId: 'batch-ocr', action, payload }))
}

function runTask(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  const handler = harness.tasks.get(action)
  if (handler === undefined) throw new Error(`未注册任务：${action}`)
  const ctx: TaskHandlerContext<unknown> = {
    toolId: 'batch-ocr',
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
  it('壳入口注册 export/config 两通道与 recognize 任务', async () => {
    const harness = createHarness()
    registerMain(harness.ctx)
    expect(harness.ipc.has('export')).toBe(true)
    expect(harness.ipc.has('config')).toBe(true)
    expect(harness.tasks.has('recognize')).toBe(true)
  })
})

describe('recognize', () => {
  const paths = ['C:\\图 片\\a.png', 'C:\\图 片\\b.png']

  it('预检通过后以 600s 超时提交 worker 并透传进度', async () => {
    const harness = createHarness()
    await expect(runTask(harness, 'recognize', { inputPaths: paths })).resolves.toEqual(RESULT)

    const run = harness.runs[0]
    expect(run?.workerPath).toBe('C:\\fake\\batch.worker.js')
    expect(run?.timeoutMs).toBe(OP_TIMEOUT_MS)
    expect(run?.payload).toEqual({ inputPaths: paths, binariesDir: join(harness.root, 'ocr') })
    expect(harness.emitted[0]?.kind).toBe('progress')
  })

  it('非法扩展名/空数组/重复路径 → BO_INVALID_PAYLOAD 且不触发 worker', async () => {
    for (const inputPaths of [[], ['a.pdf'], ['a.png', 'a.png']]) {
      const harness = createHarness()
      await expectCode(runTask(harness, 'recognize', { inputPaths }), 'BO_INVALID_PAYLOAD')
      expect(harness.runs).toHaveLength(0)
    }
  })

  it('单张预检失败保留为失败项，其余继续识别', async () => {
    const harness = createHarness({
      checkReadable: async (path) => {
        if (path.endsWith('a.png')) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      }
    })
    const result = (await runTask(harness, 'recognize', {
      inputPaths: paths
    })) as RecognizeResult
    expect(result.items[0]).toMatchObject({ status: 'failed', inputPath: paths[0] })
    expect(result.items[1]).toMatchObject({ status: 'done' })
    expect(harness.runs[0]?.payload).toMatchObject({ inputPaths: [paths[1]] })
  })

  it('占用/超大文件归对应错误码；无可用图片时不启动 worker', async () => {
    const locked = createHarness({
      checkExclusive: async () => {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      }
    })
    const lockedResult = (await runTask(locked, 'recognize', {
      inputPaths: paths
    })) as RecognizeResult
    expect(lockedResult.items.every((item) => item.status === 'failed')).toBe(true)
    expect(lockedResult.items[0]).toMatchObject({
      error: { code: 'BO_FILE_LOCKED', detail: 'EBUSY' }
    })
    expect(locked.runs).toHaveLength(0)

    const big = createHarness({ statSize: async () => 20 * 1024 * 1024 + 1 })
    const bigResult = (await runTask(big, 'recognize', { inputPaths: paths })) as RecognizeResult
    expect(bigResult.items[0]).toMatchObject({ error: { code: 'BO_IMAGE_TOO_LARGE' } })
    expect(big.runs).toHaveLength(0)
  })

  it('stat 失败/无 errno 异常走兜底文案', async () => {
    const harness = createHarness({
      statSize: async () => {
        throw new Error('stat failed')
      }
    })
    const result = (await runTask(harness, 'recognize', { inputPaths: paths })) as RecognizeResult
    expect(result.items[0]).toMatchObject({ error: { code: 'BO_FILE_NOT_FOUND' } })
  })

  it('worker 缺少条目时补失败项', async () => {
    const harness = createHarness({
      run: async () => ({ items: [RESULT.items[0]!] })
    })
    const result = (await runTask(harness, 'recognize', { inputPaths: paths })) as RecognizeResult
    expect(result.items[1]).toMatchObject({
      status: 'failed',
      error: { code: 'BO_OCR_FAILED' }
    })
  })

  it('超时 → OP_TIMEOUT；崩溃 → BO_OCR_FAILED（带 cause 尾部）', async () => {
    const timeout = createHarness({
      run: async () => {
        throw new TaskTimeoutError(600_000)
      }
    })
    await expectCode(runTask(timeout, 'recognize', { inputPaths: paths }), 'OP_TIMEOUT')

    const crash = createHarness({
      run: async () => {
        throw new TaskCrashError('worker exit', new Error('out of memory'))
      }
    })
    const error = await expectCode(
      runTask(crash, 'recognize', { inputPaths: paths }),
      'BO_OCR_FAILED'
    )
    expect(error.detail).toContain('out of memory')
  })

  it('mapWorkerError：崩溃原因字符串/缺省、ocr-kit PDF_* 归一、未知码原样返回', () => {
    expect(mapWorkerError(new TaskCrashError('worker exit', 'killed'))).toMatchObject({
      code: 'BO_OCR_FAILED',
      detail: 'killed'
    })
    expect(mapWorkerError(new TaskCrashError('worker exit'))).toMatchObject({
      code: 'BO_OCR_FAILED',
      detail: 'worker exit'
    })
    expect(mapWorkerError({ code: 'PDF_LOCKED', message: '占用', detail: 'EBUSY' })).toMatchObject({
      code: 'BO_FILE_LOCKED',
      detail: 'EBUSY'
    })
    const custom = { code: 'SOMETHING', message: '自定义错误' }
    expect(mapWorkerError(custom)).toBe(custom)
  })

  it('模型缺失结构化错误透传且不启动 worker', async () => {
    const harness = createHarness({
      ocrBinariesDir: async () => {
        throw toolError('MODEL_MISSING', 'det: ENOENT')
      }
    })
    const error = await expectCode(
      runTask(harness, 'recognize', { inputPaths: paths }),
      'MODEL_MISSING'
    )
    expect(error.detail).toBe('det: ENOENT')
    expect(harness.runs).toHaveLength(0)
  })

  it('取消信号原样传给 runTask', async () => {
    const harness = createHarness()
    await runTask(harness, 'recognize', { inputPaths: paths })
    expect(harness.runs[0]?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('export / config', () => {
  const items = [
    { fileName: 'page 1.png', text: '第一页' },
    { fileName: 'page 2.jpg', text: '第二页' }
  ]

  it('逐张导出：命名、内容与目录记忆', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, '导出 目录')
    const result = (await invoke(harness, 'export', {
      outputDir,
      mode: 'per-file',
      items
    })) as { outputs: string[] }

    expect(result.outputs).toEqual([
      join(outputDir, 'page 1-OCR.txt'),
      join(outputDir, 'page 2-OCR.txt')
    ])
    expect(readFileSync(result.outputs[0]!, 'utf8')).toBe('第一页')
    expect(harness.settings.get('outputDir')).toBe(outputDir)
  })

  it('逐张导出同名自动递增 (1)', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, 'dup')
    await invoke(harness, 'export', { outputDir, mode: 'per-file', items })
    const second = (await invoke(harness, 'export', {
      outputDir,
      mode: 'per-file',
      items: [items[0]]
    })) as { outputs: string[] }
    expect(second.outputs[0]).toBe(join(outputDir, 'page 1-OCR(1).txt'))
  })

  it('合并导出：单文件带分段标题且冲突递增', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, 'merged')
    const first = (await invoke(harness, 'export', {
      outputDir,
      mode: 'merged',
      items
    })) as { outputs: string[] }
    expect(first.outputs).toHaveLength(1)
    const content = readFileSync(first.outputs[0]!, 'utf8')
    expect(content).toContain('===== page 1.png =====\n第一页')
    expect(content).toContain('===== page 2.jpg =====\n第二页')

    const second = (await invoke(harness, 'export', {
      outputDir,
      mode: 'merged',
      items
    })) as { outputs: string[] }
    expect(second.outputs[0]).toMatch(/OCR-合并-\d{8}-\d{6}\(1\)\.txt$/)
  })

  it('目录创建/写盘失败 → OUTPUT_WRITE_FAILED', async () => {
    const mkdirFail = createHarness({
      fs: {
        mkdir: () => {
          throw Object.assign(new Error('denied'), { code: 'EPERM' })
        },
        writeAtomic: () => undefined,
        exists: () => false
      }
    })
    await expectCode(
      invoke(mkdirFail, 'export', { outputDir: 'C:\\x', mode: 'per-file', items }),
      'OUTPUT_WRITE_FAILED'
    )

    const writeFail = createHarness({
      fs: {
        mkdir: () => undefined,
        writeAtomic: () => {
          throw Object.assign(new Error('full'), { code: 'ENOSPC' })
        },
        exists: () => false
      }
    })
    const error = await expectCode(
      invoke(writeFail, 'export', { outputDir: 'C:\\x', mode: 'merged', items }),
      'OUTPUT_WRITE_FAILED'
    )
    expect(error.detail).toBe('ENOSPC')
  })

  it('非法导出载荷（缺失/路径分隔符/空文本）→ BO_INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expectCode(invoke(harness, 'export', { mode: 'merged', items }), 'BO_INVALID_PAYLOAD')
    await expectCode(
      invoke(harness, 'export', {
        outputDir: 'C:\\x',
        mode: 'per-file',
        items: [{ fileName: '..\\evil.png', text: 'x' }]
      }),
      'BO_INVALID_PAYLOAD'
    )
    await expectCode(
      invoke(harness, 'export', {
        outputDir: 'C:\\x',
        mode: 'per-file',
        items: [{ fileName: 'a.png', text: '' }]
      }),
      'BO_INVALID_PAYLOAD'
    )
  })

  it('config 缺省 userData/batch-ocr，导出后回填记忆', async () => {
    const harness = createHarness()
    const initial = (await invoke(harness, 'config', {})) as { outputDir: string }
    expect(initial.outputDir).toBe(join(harness.userData, 'batch-ocr'))

    const outputDir = join(harness.root, 'remember')
    await invoke(harness, 'export', { outputDir, mode: 'per-file', items })
    const after = (await invoke(harness, 'config', {})) as { outputDir: string }
    expect(after.outputDir).toBe(outputDir)
  })

  it('未注入 fs 时走真实默认实现（递归建目录/原子写/占用探测）', async () => {
    const harness = createHarness({ fs: undefined })
    const outputDir = join(harness.root, '真实 fs 目录')
    const result = (await invoke(harness, 'export', {
      outputDir,
      mode: 'per-file',
      items: [items[0]!]
    })) as { outputs: string[] }
    expect(readFileSync(result.outputs[0]!, 'utf8')).toBe('第一页')
  })
})

describe('createNodeDeps', () => {
  it('真实 fs 实现对普通文件可读/独占/取体积', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lumin-batch-ocr-deps-'))
    roots.push(root)
    const file = join(root, 'a.png')
    writeFileSync(file, 'x')
    const deps = createNodeDeps(root, 'C:\\fake\\batch.worker.js')
    await expect(deps.checkReadable(file)).resolves.toBeUndefined()
    await expect(deps.checkExclusive(file)).resolves.toBeUndefined()
    await expect(deps.statSize(file)).resolves.toBe(1)
  })

  it('模型资产缺失时抛 MODEL_MISSING', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lumin-batch-ocr-models-'))
    roots.push(root)
    const deps = createNodeDeps(root, 'C:\\fake\\batch.worker.js')
    await expect(deps.ocrBinariesDir()).rejects.toMatchObject({ code: 'MODEL_MISSING' })
  })
})
