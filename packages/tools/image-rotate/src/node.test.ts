/**
 * @file node.ts 单测（假 runProcess 注入，不依赖真实 ffmpeg）
 * @author cuilanchao
 * @date 2026-11-20
 * @description config/set-output-dir/process 通道行为：引擎缺失、目录创建失败、
 *              成功/失败混合、冲突递增、取消不记失败、磁盘满归类、输出目录记忆
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RunProcessOptions, RunProcessResult } from '@lumin/node-kit'
import type {
  IpcHandler,
  MainPluginContext,
  TaskHandler,
  TaskHandlerContext
} from '@lumin/plugin-api'
import type { StructuredError, TaskUpdate } from '@lumin/shared'
import { manifest } from './manifest'
import { registerMain, registerWith, type ImageRotateDeps } from './node'

const okResult = (overrides: Partial<RunProcessResult> = {}): RunProcessResult => ({
  code: 0,
  signal: null,
  stdout: '',
  stderr: '',
  timedOut: false,
  aborted: false,
  truncated: false,
  ...overrides
})

interface HarnessOptions {
  /** ffmpeg 退出码 */
  ffmpegCode?: number
  /** ffmpeg stderr */
  ffmpegStderr?: string
  /** 输入路径包含该子串时按「解码失败」返回（模拟单张损坏） */
  failForInput?: string
  /** ffmpeg 执行后置 aborted（模拟取消杀树） */
  abortAfterRun?: boolean
  /** 引擎目录是否预置 ffmpeg（默认预置） */
  withEngine?: boolean
}

interface Harness {
  ipc: Map<string, IpcHandler<unknown, unknown>>
  tasks: Map<string, TaskHandler<unknown, unknown>>
  settings: Map<string, unknown>
  binariesRoot: string
  userData: string
  calls: RunProcessOptions[]
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createHarness(options: HarnessOptions = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-ir-test-'))
  roots.push(root)
  const binariesRoot = join(root, 'binaries')
  const engineDir = join(binariesRoot, 'download')
  const userData = join(root, 'userData')
  if (options.withEngine !== false) {
    mkdirSync(engineDir, { recursive: true })
    writeFileSync(join(engineDir, 'ffmpeg.exe'), 'stub')
  }

  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const calls: RunProcessOptions[] = []

  const deps: ImageRotateDeps = {
    runProcess: (opts) => {
      calls.push(opts)
      const args = opts.args ?? []
      const input = args[args.indexOf('-i') + 1] ?? ''
      const forcedFailure =
        options.failForInput !== undefined && input.includes(options.failForInput)
      const output = args[args.length - 1]
      if (
        typeof output === 'string' &&
        !forcedFailure &&
        (options.ffmpegCode ?? 0) === 0 &&
        (options.abortAfterRun ?? false) === false
      ) {
        writeFileSync(output, Buffer.alloc(64, 1))
      }
      return Promise.resolve(
        okResult({
          code: forcedFailure ? 1 : (options.ffmpegCode ?? 0),
          stderr: forcedFailure
            ? 'Invalid data found when processing input'
            : (options.ffmpegStderr ?? ''),
          aborted: options.abortAfterRun ?? false
        })
      )
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
    paths: { temp: join(root, 'temp'), userData, binaries: binariesRoot }
  }
  registerWith(ctx, deps)
  return { ipc, tasks, settings, binariesRoot, userData, calls }
}

function mustGet<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key)
  if (value === undefined) throw new Error(`缺少 handler：${String(key)}`)
  return value
}

/** noUncheckedIndexedAccess 收窄：取首元素，空数组抛错 */
function firstOf<T>(items: T[]): T {
  const item = items[0]
  if (item === undefined) throw new Error('数组为空')
  return item
}

async function invokeIpc(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  return mustGet(harness.ipc, action)({ toolId: manifest.id, action, payload })
}

async function runTask(
  harness: Harness,
  payload: unknown,
  opts: { signal?: AbortSignal } = {}
): Promise<{ result: unknown; updates: TaskUpdate[]; error?: StructuredError }> {
  const updates: TaskUpdate[] = []
  const taskCtx: TaskHandlerContext<unknown> = {
    toolId: manifest.id,
    action: 'process',
    payload,
    taskId: 'task-1',
    signal: opts.signal ?? new AbortController().signal,
    emit: (update) => updates.push(update)
  }
  try {
    const result = await mustGet(harness.tasks, 'process')(taskCtx)
    return { result, updates }
  } catch (err) {
    return { result: undefined, updates, error: err as StructuredError }
  }
}

/** 造一个假输入图片文件（内容任意，编码走假 ffmpeg） */
function makeInput(dir: string, name: string, bytes = 1000): string {
  const path = join(dir, name)
  writeFileSync(path, Buffer.alloc(bytes, 0))
  return path
}

type ProcessOutput = { outputs: { input: string; output: string }[]; failures: { code: string }[] }

describe('registerMain', () => {
  it('生产入口注册三通道（config / set-output-dir / process）', () => {
    const actions: string[] = []
    const root = mkdtempSync(join(tmpdir(), 'lumin-ir-main-'))
    roots.push(root)
    const ctx: MainPluginContext = {
      toolId: manifest.id,
      manifest,
      registerIpc: (action) => {
        actions.push(action)
      },
      registerTask: (action) => {
        actions.push(action)
      },
      settings: {
        get: async (_key, defaultValue) => defaultValue,
        set: async () => undefined
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
    registerMain(ctx)
    expect(actions).toEqual(['config', 'set-output-dir', 'process'])
  })
})

describe('config / set-output-dir', () => {
  it('缺省输出目录 = userData/image-rotate', async () => {
    const harness = createHarness()
    await expect(invokeIpc(harness, 'config', {})).resolves.toEqual({
      outputDir: join(harness.userData, 'image-rotate')
    })
  })

  it('已记忆目录优先回填', async () => {
    const harness = createHarness()
    harness.settings.set('outputDir', 'E:\\remembered')
    await expect(invokeIpc(harness, 'config', {})).resolves.toEqual({
      outputDir: 'E:\\remembered'
    })
  })

  it('set-output-dir 落盘；空值 → INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await invokeIpc(harness, 'set-output-dir', { outputDir: 'E:\\out' })
    expect(harness.settings.get('outputDir')).toBe('E:\\out')
    await expect(invokeIpc(harness, 'set-output-dir', { outputDir: '' })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })
})

describe('process 批次级校验', () => {
  it('引擎缺失 → IR_ENGINE_MISSING', async () => {
    const harness = createHarness({ withEngine: false })
    const { error } = await runTask(harness, {
      files: ['C:\\a.png'],
      outputDir: join(harness.userData, 'out'),
      options: { rotation: '90', flip: 'none' }
    })
    expect(error?.code).toBe('IR_ENGINE_MISSING')
  })

  it('空文件列表 → INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    const { error } = await runTask(harness, {
      files: [],
      outputDir: join(harness.userData, 'out'),
      options: { rotation: '90', flip: 'none' }
    })
    expect(error?.code).toBe('INVALID_PAYLOAD')
  })

  it('旋转与翻转均为 none → INVALID_PAYLOAD（中文文案）', async () => {
    const harness = createHarness()
    const { error } = await runTask(harness, {
      files: ['C:\\a.png'],
      outputDir: join(harness.userData, 'out'),
      options: { rotation: 'none', flip: 'none' }
    })
    expect(error?.code).toBe('INVALID_PAYLOAD')
    expect(error?.message).toBe('请选择旋转角度或翻转方式')
  })

  it('输出目录不可建（路径为已有文件）→ IR_OUTPUT_WRITE_FAILED', async () => {
    const harness = createHarness()
    const blocked = join(harness.userData, 'blocked')
    mkdirSync(harness.userData, { recursive: true })
    writeFileSync(blocked, 'x')
    const { error } = await runTask(harness, {
      files: ['C:\\a.png'],
      outputDir: blocked,
      options: { rotation: '90', flip: 'none' }
    })
    expect(error?.code).toBe('IR_OUTPUT_WRITE_FAILED')
  })
})

describe('process 批量语义', () => {
  it('成功 + 损坏 + 不支持扩展名混合：失败不中断，错误码逐张', async () => {
    const harness = createHarness({ failForInput: 'broken.jpg' })
    const dir = mkdtempSync(join(tmpdir(), 'lumin-ir-in-'))
    roots.push(dir)
    const good = makeInput(dir, 'good.png')
    const broken = makeInput(dir, 'broken.jpg')
    const unsupported = makeInput(dir, 'note.txt')
    const outputDir = join(harness.userData, 'out')

    const { result } = await runTask(harness, {
      files: [good, broken, unsupported],
      outputDir,
      options: { rotation: '90', flip: 'none' }
    })
    const parsed = result as ProcessOutput
    expect(parsed.outputs).toHaveLength(1)
    expect(parsed.outputs[0]?.output.endsWith('good_旋转90.png')).toBe(true)
    expect(parsed.failures.map((f) => f.code)).toEqual(['IR_FILE_CORRUPT', 'IR_FILE_UNSUPPORTED'])
  })

  it('ffmpeg 损坏 → IR_FILE_CORRUPT；磁盘满 → IR_OUTPUT_WRITE_FAILED', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumin-ir-in-'))
    roots.push(dir)
    const file = makeInput(dir, 'broken.jpg')

    const corrupt = createHarness({ ffmpegCode: 1, ffmpegStderr: 'Invalid data found' })
    const corruptRun = await runTask(corrupt, {
      files: [file],
      outputDir: join(corrupt.userData, 'out'),
      options: { rotation: 'none', flip: 'horizontal' }
    })
    expect((corruptRun.result as ProcessOutput).failures[0]?.code).toBe('IR_FILE_CORRUPT')

    const diskFull = createHarness({ ffmpegCode: 1, ffmpegStderr: 'No space left on device' })
    const diskRun = await runTask(diskFull, {
      files: [file],
      outputDir: join(diskFull.userData, 'out'),
      options: { rotation: 'none', flip: 'horizontal' }
    })
    expect((diskRun.result as ProcessOutput).failures[0]?.code).toBe('IR_OUTPUT_WRITE_FAILED')
  })

  it('滤镜与编码参数：先翻转后旋转 + png 压缩参数', async () => {
    const harness = createHarness()
    const dir = mkdtempSync(join(tmpdir(), 'lumin-ir-in-'))
    roots.push(dir)
    const file = makeInput(dir, 'a.png')
    await runTask(harness, {
      files: [file],
      outputDir: join(harness.userData, 'out'),
      options: { rotation: '90', flip: 'horizontal' }
    })
    const call = harness.calls[0]
    expect(call?.args).toEqual([
      '-y',
      '-v',
      'error',
      '-i',
      file,
      '-vf',
      'hflip,transpose=1',
      '-compression_level',
      '6',
      join(harness.userData, 'out', 'a_旋转90_水平翻转.png')
    ])
  })

  it('冲突递增：已存在同名与同批次重复输入均追加 (n)', async () => {
    const harness = createHarness()
    const dir = mkdtempSync(join(tmpdir(), 'lumin-ir-in-'))
    roots.push(dir)
    const file = makeInput(dir, 'a.png')
    const outputDir = join(harness.userData, 'out')
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(join(outputDir, 'a_旋转90.png'), 'existing')

    const { result } = await runTask(harness, {
      files: [file, file],
      outputDir,
      options: { rotation: '90', flip: 'none' }
    })
    const parsed = result as ProcessOutput
    expect(parsed.outputs.map((item) => item.output.replace(/^.*[\\/]/, ''))).toEqual([
      'a_旋转90 (1).png',
      'a_旋转90 (2).png'
    ])
    expect(harness.settings.get('outputDir')).toBe(outputDir)
  })

  it('取消：运行中 aborted → IR_CANCELLED 跳出且不记失败', async () => {
    const harness = createHarness({ abortAfterRun: true })
    const dir = mkdtempSync(join(tmpdir(), 'lumin-ir-in-'))
    roots.push(dir)
    const file = makeInput(dir, 'a.png')
    const { result, updates } = await runTask(harness, {
      files: [file, makeInput(dir, 'b.png')],
      outputDir: join(harness.userData, 'out'),
      options: { rotation: '180', flip: 'none' }
    })
    const parsed = result as ProcessOutput
    expect(parsed.outputs).toEqual([])
    expect(parsed.failures).toEqual([])
    expect(updates.some((u) => u.kind === 'progress')).toBe(true)
  })

  it('进入前已 abort → 不执行任何文件，进度补 total', async () => {
    const harness = createHarness()
    const controller = new AbortController()
    controller.abort()
    const { result, updates } = await runTask(
      harness,
      {
        files: ['C:\\a.png'],
        outputDir: join(harness.userData, 'out'),
        options: { rotation: '270', flip: 'none' }
      },
      { signal: controller.signal }
    )
    expect((result as ProcessOutput).outputs).toEqual([])
    expect(harness.calls).toHaveLength(0)
    const last = updates[updates.length - 1]
    expect(last).toMatchObject({ kind: 'progress', current: 1, total: 1 })
  })

  it('目录/不支持文件：目录伪扩展名与非图片均记失败，不调用 ffmpeg', async () => {
    const harness = createHarness()
    const dir = mkdtempSync(join(tmpdir(), 'lumin-ir-in-'))
    roots.push(dir)
    const folded = join(dir, 'folder.png')
    mkdirSync(folded)
    const { result } = await runTask(harness, {
      files: [folded, join(dir, 'missing.png'), join(dir, 'x.gif')],
      outputDir: join(harness.userData, 'out'),
      options: { rotation: '90', flip: 'none' }
    })
    expect((result as ProcessOutput).failures.map((f) => f.code)).toEqual([
      'IR_FILE_UNSUPPORTED',
      'IR_FILE_UNSUPPORTED',
      'IR_FILE_UNSUPPORTED'
    ])
    expect(harness.calls).toHaveLength(0)
  })
})

describe('process 进度事件', () => {
  it('逐张 progress + 收尾 total', async () => {
    const harness = createHarness()
    const dir = mkdtempSync(join(tmpdir(), 'lumin-ir-in-'))
    roots.push(dir)
    const { updates } = await runTask(harness, {
      files: [makeInput(dir, 'a.png'), makeInput(dir, 'b.png')],
      outputDir: join(harness.userData, 'out'),
      options: { rotation: 'none', flip: 'vertical' }
    })
    const progress = updates.filter((u) => u.kind === 'progress')
    expect(progress.map((u) => u.kind === 'progress' && u.current)).toEqual([0, 1, 2])
    expect(firstOf(progress)).toMatchObject({ total: 2, message: 'a.png' })
  })
})
