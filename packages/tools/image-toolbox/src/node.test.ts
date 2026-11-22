/**
 * @file node.ts 单测（假 runProcess 注入，不依赖真实 ffmpeg）
 * @author cuilanchao
 * @date 2026-11-19
 * @description probe/config/process 通道行为：引擎缺失、单张失败不中断批次、动图参数分发、
 *              冲突自动重命名、缩放尺寸探测联动、取消不记失败、磁盘满归类、输出目录记忆；
 *              2026-11-19 起探测改解析 `ffmpeg -i` stderr（parseFfmpegStream 纯函数单测）
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
import { parseFfmpegStream, registerWith, type ImageToolboxDeps } from './node'

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

/** ffmpeg `-i` stderr 样例（64×48 静态 jpg；实测行形如 `Stream #0:0: Video: mjpeg, ...`） */
function probeStderr(width = 64, height = 48, codec = 'mjpeg'): string {
  return [
    "Input #0, image2, from 'C:\\x.jpg':",
    '  Duration: N/A, bitrate: N/A',
    `  Stream #0:0: Video: ${codec}, yuvj420p(pc), ${width}x${height} [SAR 1:1 DAR 4:3], 25 fps`
  ].join('\n')
}

interface HarnessOptions {
  /** 探测（`ffmpeg -i`）返回的 stderr（按调用序或全局） */
  probeResponses?: string[]
  /** ffmpeg 退出码 */
  ffmpegCode?: number
  /** ffmpeg stderr */
  ffmpegStderr?: string
  /** ffmpeg 假执行时写出的输出文件字节数（statSync 断言用） */
  outputBytes?: number
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
  const root = mkdtempSync(join(tmpdir(), 'lumin-it-test-'))
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
  let probeIndex = 0

  const deps: ImageToolboxDeps = {
    runProcess: (opts) => {
      calls.push(opts)
      // 探测 = `ffmpeg -hide_banner -i <file>`（无输出文件，真实引擎以 code 1 退出）
      const isProbe = opts.args?.[0] === '-hide_banner'
      if (isProbe) {
        const stderr =
          options.probeResponses !== undefined && probeIndex < options.probeResponses.length
            ? (options.probeResponses[probeIndex] ?? probeStderr())
            : probeStderr()
        probeIndex++
        return Promise.resolve(okResult({ code: 1, stderr }))
      }
      // ffmpeg 假执行：写出输出文件（末位参数）供 statSync 统计体积
      const output = opts.args?.[opts.args.length - 1]
      if (typeof output === 'string' && (options.ffmpegCode ?? 0) === 0) {
        writeFileSync(output, Buffer.alloc(options.outputBytes ?? 100, 1))
      }
      return Promise.resolve(
        okResult({
          code: options.ffmpegCode ?? 0,
          stderr: options.ffmpegStderr ?? '',
          aborted: options.abortAfterRun ?? false
        })
      )
    },
    now: () => Date.now()
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

/** 取首个编码调用（探测调用也是 ffmpeg，以 `-hide_banner` 首参区分；编码首参为 `-y`） */
function findEncodeCall(harness: Harness): RunProcessOptions | undefined {
  return harness.calls.find((c) => c.args?.[0] === '-y')
}

async function invokeIpc(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  return mustGet(harness.ipc, action)({ toolId: manifest.id, action, payload })
}

async function runTask(
  harness: Harness,
  payload: unknown,
  opts: { signal?: AbortSignal; action?: string } = {}
): Promise<{ result: unknown; updates: TaskUpdate[]; error?: StructuredError }> {
  const action = opts.action ?? 'process'
  const updates: TaskUpdate[] = []
  const taskCtx: TaskHandlerContext<unknown> = {
    toolId: manifest.id,
    action,
    payload,
    taskId: 'task-1',
    signal: opts.signal ?? new AbortController().signal,
    emit: (update) => updates.push(update)
  }
  try {
    const result = await mustGet(harness.tasks, action)(taskCtx)
    return { result, updates }
  } catch (err) {
    return { result: undefined, updates, error: err as StructuredError }
  }
}

/** 造一个假输入图片文件（内容任意，探测走假 ffmpeg） */
function makeInput(dir: string, name: string, bytes = 1000): string {
  const path = join(dir, name)
  writeFileSync(path, Buffer.alloc(bytes, 0))
  return path
}

describe('parseFfmpegStream', () => {
  it('解析普通视频流行（codec + 宽高）', () => {
    expect(parseFfmpegStream(probeStderr(320, 240, 'png'))).toEqual({
      codecName: 'png',
      width: 320,
      height: 240
    })
  })

  it('兼容 [0x1] 流序号与 codec 括号档位（实测 avif / jpg 行）', () => {
    const avif = '  Stream #0:0[0x1]: Video: av1 (High), gbrp(pc), 320x240 [SAR 1:1 DAR 4:3], 1 fps'
    expect(parseFfmpegStream(avif)).toEqual({ codecName: 'av1', width: 320, height: 240 })
    const jpg = '  Stream #0:0: Video: mjpeg (Baseline), yuvj444p(pc), 320x240, 25 fps'
    expect(parseFfmpegStream(jpg)).toEqual({ codecName: 'mjpeg', width: 320, height: 240 })
  })

  it('无视频流 / 零尺寸 → null', () => {
    expect(parseFfmpegStream('Invalid data found when processing input')).toBeNull()
    expect(parseFfmpegStream('  Stream #0:0: Video: mjpeg, yuvj420p(pc), 0x0, 25 fps')).toBeNull()
  })
})

describe('probe', () => {
  it('引擎缺失 → IT_ENGINE_MISSING', async () => {
    const harness = createHarness({ withEngine: false })
    await expect(invokeIpc(harness, 'probe', { files: ['C:\\a.jpg'] })).rejects.toMatchObject({
      code: 'IT_ENGINE_MISSING'
    })
  })

  it('payload 空文件列表 → INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expect(invokeIpc(harness, 'probe', { files: [] })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })

  it('成功项 + 动图标志 + 单张失败不阻塞', async () => {
    const harness = createHarness({
      probeResponses: [
        probeStderr(800, 600, 'mjpeg'),
        probeStderr(100, 100, 'gif'),
        'garbage output'
      ]
    })
    const dir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(dir)
    const good = makeInput(dir, 'good.jpg')
    const anim = makeInput(dir, 'anim.gif')
    const broken = makeInput(dir, 'broken.png')
    const result = (await invokeIpc(harness, 'probe', { files: [good, anim, broken] })) as {
      items: { file: string; format: string; width: number; height: number; animated: boolean }[]
      failures: { file: string; code: string }[]
    }
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({
      file: good,
      format: 'mjpeg',
      width: 800,
      height: 600,
      animated: false
    })
    expect(result.items[1]).toMatchObject({ format: 'gif', animated: true })
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ file: broken, code: 'IT_PROBE_FAILED' })
  })

  it('损坏图片（ffmpeg 报 Invalid data、无视频流）→ IT_FILE_CORRUPT，不落入 zod 兜底', async () => {
    const harness = createHarness({
      probeResponses: ['C:\\x.jpg: Invalid data found when processing input']
    })
    const dir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(dir)
    const corrupt = makeInput(dir, '损坏.jpg')
    const result = (await invokeIpc(harness, 'probe', { files: [corrupt] })) as {
      failures: { file: string; code: string }[]
    }
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ file: corrupt, code: 'IT_FILE_CORRUPT' })
  })

  it('损坏 jpg（实测：有视频流行但取不到尺寸）→ IT_FILE_CORRUPT', async () => {
    const harness = createHarness({
      probeResponses: [
        [
          '[mjpeg @ 000001] No JPEG data found in image',
          '[image2 @ 000002] Could not find codec parameters for stream 0 (Video: mjpeg, none(bt470bg/unknown/unknown)):',
          "Input #0, image2, from 'C:\\x.jpg':",
          '  Stream #0:0: Video: mjpeg, none(bt470bg/unknown/unknown), 25 fps, 25 tbr, 25 tbn'
        ].join('\n')
      ]
    })
    const dir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(dir)
    const corrupt = makeInput(dir, '损坏.jpg')
    const result = (await invokeIpc(harness, 'probe', { files: [corrupt] })) as {
      failures: { code: string }[]
    }
    expect(result.failures[0]).toMatchObject({ code: 'IT_FILE_CORRUPT' })
  })

  it('不可解析的探测输出 → IT_PROBE_FAILED', async () => {
    const harness = createHarness({ probeResponses: ['garbage output'] })
    const dir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(dir)
    const weird = makeInput(dir, 'weird.png')
    const result = (await invokeIpc(harness, 'probe', { files: [weird] })) as {
      failures: { code: string }[]
    }
    expect(result.failures[0]).toMatchObject({ code: 'IT_PROBE_FAILED' })
  })

  it('不支持的扩展名 → IT_FILE_UNSUPPORTED（不调引擎）', async () => {
    const harness = createHarness()
    const dir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(dir)
    const bad = makeInput(dir, 'evil.exe')
    const result = (await invokeIpc(harness, 'probe', { files: [bad] })) as {
      items: unknown[]
      failures: { code: string }[]
    }
    expect(result.items).toHaveLength(0)
    expect(result.failures[0]).toMatchObject({ code: 'IT_FILE_UNSUPPORTED' })
    expect(harness.calls).toHaveLength(0)
  })

  it('文件不存在 → IT_FILE_UNSUPPORTED', async () => {
    const harness = createHarness()
    const result = (await invokeIpc(harness, 'probe', { files: ['C:\\no-such\\x.jpg'] })) as {
      failures: { code: string }[]
    }
    expect(result.failures[0]).toMatchObject({ code: 'IT_FILE_UNSUPPORTED' })
  })
})

describe('config', () => {
  it('未保存过 → userData/images 缺省', async () => {
    const harness = createHarness()
    const result = (await invokeIpc(harness, 'config', {})) as { outputDir: string }
    expect(result.outputDir).toBe(join(harness.userData, 'images'))
  })

  it('处理过 → 记忆目录回填', async () => {
    const harness = createHarness()
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    await runTask(harness, {
      mode: 'compress',
      files: [makeInput(outDir, 'a.jpg')],
      outputDir: outDir,
      options: { quality: 75, target: 'original' }
    })
    const result = (await invokeIpc(harness, 'config', {})) as { outputDir: string }
    expect(result.outputDir).toBe(outDir)
  })
})

describe('set-output-dir', () => {
  it('选择目录后即时记忆（config 可读）', async () => {
    const picked = mkdtempSync(join(tmpdir(), 'lumin-it-pick-'))
    roots.push(picked)
    const harness = createHarness()
    await invokeIpc(harness, 'set-output-dir', { outputDir: picked })
    const config = (await invokeIpc(harness, 'config', {})) as { outputDir: string }
    expect(config.outputDir).toBe(picked)
  })

  it('空目录 → INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expect(invokeIpc(harness, 'set-output-dir', { outputDir: '' })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })
})

describe('process', () => {
  const compressPayload = (files: string[], outputDir: string) => ({
    mode: 'compress' as const,
    files,
    outputDir,
    options: { quality: 75, target: 'original' as const }
  })

  it('引擎缺失 → 批次级 IT_ENGINE_MISSING', async () => {
    const harness = createHarness({ withEngine: false })
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const { error } = await runTask(harness, compressPayload(['C:\\a.jpg'], outDir))
    expect(error).toMatchObject({ code: 'IT_ENGINE_MISSING' })
  })

  it('批量压缩：命名/体积/进度事件/settings 记忆', async () => {
    const harness = createHarness({ outputBytes: 400 })
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const a = makeInput(inDir, 'a.jpg', 1000)
    const b = makeInput(inDir, 'b.png', 2000)
    const { result, updates, error } = await runTask(harness, compressPayload([a, b], outDir))
    expect(error).toBeUndefined()
    const r = result as {
      outputs: { input: string; output: string; beforeBytes: number; afterBytes: number }[]
    }
    expect(r.outputs).toHaveLength(2)
    expect(firstOf(r.outputs)).toMatchObject({ input: a, beforeBytes: 1000, afterBytes: 400 })
    expect(firstOf(r.outputs).output).toBe(join(outDir, 'a.q75.jpg'))
    expect(r.outputs[1]?.output).toBe(join(outDir, 'b.q75.png'))
    // 进度事件：0/2、1/2、2/2
    expect(updates.filter((u) => u.kind === 'progress')).toHaveLength(3)
    expect(harness.settings.get('outputDir')).toBe(outDir)
  })

  it('gif 压缩「原格式」→ webp 动画参数（-loop 0，无 -frames:v）', async () => {
    const harness = createHarness()
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const gif = makeInput(inDir, 'anim.gif')
    await runTask(harness, compressPayload([gif], outDir))
    const ffmpegCall = findEncodeCall(harness)
    expect(ffmpegCall).toBeDefined()
    expect(ffmpegCall?.args).toContain('-loop')
    expect(ffmpegCall?.args).not.toContain('-frames:v')
    expect(ffmpegCall?.args).toContain(join(outDir, 'anim.q75.webp'))
  })

  it('gif 转 jpg → 首帧参数（-frames:v 1）', async () => {
    const harness = createHarness()
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const gif = makeInput(inDir, 'anim.gif')
    await runTask(harness, {
      mode: 'convert',
      files: [gif],
      outputDir: outDir,
      options: { format: 'jpg', quality: 75 }
    })
    const ffmpegCall = findEncodeCall(harness)
    expect(ffmpegCall?.args).toContain('-frames:v')
    expect(ffmpegCall?.args).not.toContain('-loop')
  })

  it('同批次同名输入 → 自动重命名互不覆盖', async () => {
    const harness = createHarness()
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    // 两份同名 a.jpg（不同目录）压缩同目标
    const sub = join(inDir, 'sub')
    mkdirSync(sub, { recursive: true })
    const a1 = makeInput(inDir, 'a.jpg')
    const a2 = makeInput(sub, 'a.jpg')
    const { result } = await runTask(harness, compressPayload([a1, a2], outDir))
    const r = result as { outputs: { output: string }[] }
    expect(r.outputs).toHaveLength(2)
    expect(firstOf(r.outputs).output).toBe(join(outDir, 'a.q75.jpg'))
    expect(r.outputs[1]?.output).toBe(join(outDir, 'a.q75 (1).jpg'))
  })

  it('输出目录已有同名 → 自动重命名', async () => {
    const harness = createHarness()
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    writeFileSync(join(outDir, 'a.q75.jpg'), 'existing')
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const a = makeInput(inDir, 'a.jpg')
    const { result } = await runTask(harness, compressPayload([a], outDir))
    const r = result as { outputs: { output: string }[] }
    expect(firstOf(r.outputs).output).toBe(join(outDir, 'a.q75 (1).jpg'))
  })

  it('单张失败不中断批次（损坏文件 → IT_FILE_CORRUPT 失败项）', async () => {
    const harness = createHarness({
      ffmpegCode: 1,
      ffmpegStderr: 'Invalid data found when processing input'
    })
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const { result, error } = await runTask(
      harness,
      compressPayload([makeInput(inDir, 'a.jpg'), makeInput(inDir, 'b.jpg')], outDir)
    )
    expect(error).toBeUndefined()
    const r = result as { outputs: unknown[]; failures: { code: string }[] }
    expect(r.outputs).toHaveLength(0)
    expect(r.failures).toHaveLength(2)
    expect(firstOf(r.failures)).toMatchObject({ code: 'IT_FILE_CORRUPT' })
  })

  it('磁盘满（ENOSPC 文案）→ IT_OUTPUT_WRITE_FAILED', async () => {
    const harness = createHarness({
      ffmpegCode: 1,
      ffmpegStderr: 'I/O error: No space left on device'
    })
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const { result } = await runTask(harness, compressPayload([makeInput(inDir, 'a.jpg')], outDir))
    const r = result as { failures: { code: string }[] }
    expect(firstOf(r.failures)).toMatchObject({ code: 'IT_OUTPUT_WRITE_FAILED' })
  })

  it('resize：探测尺寸 → 缩放参数 + 命名模板', async () => {
    const harness = createHarness({ probeResponses: [probeStderr(1000, 600)] })
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const img = makeInput(inDir, 'photo.jpg')
    const { result } = await runTask(harness, {
      mode: 'resize',
      files: [img],
      outputDir: outDir,
      options: { mode: 'percent', percent: 50, noUpscale: false, format: 'jpg', quality: 75 }
    })
    const r = result as { outputs: { output: string }[]; failures: unknown[] }
    expect(r.failures).toHaveLength(0)
    expect(firstOf(r.outputs).output).toBe(join(outDir, 'photo.50%.jpg'))
    const ffmpegCall = findEncodeCall(harness)
    expect(ffmpegCall?.args).toContain('scale=500:300')
  })

  it('resize 不放大（目标大于原图）→ 无缩放滤镜，命名仍含尺寸段', async () => {
    const harness = createHarness({ probeResponses: [probeStderr(1000, 600)] })
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const img = makeInput(inDir, 'photo.jpg')
    const { result } = await runTask(harness, {
      mode: 'resize',
      files: [img],
      outputDir: outDir,
      options: { mode: 'percent', percent: 200, noUpscale: true, format: 'jpg', quality: 75 }
    })
    const r = result as { outputs: { output: string }[]; failures: unknown[] }
    expect(r.failures).toHaveLength(0)
    const ffmpegCall = findEncodeCall(harness)
    expect(ffmpegCall?.args).not.toContain('-vf')
    expect(firstOf(r.outputs).output).toBe(join(outDir, 'photo.200%.jpg'))
  })

  it('resize 探测失败 → 单张 IT_PROBE_FAILED，批次 done', async () => {
    const brokenHarness = createHarness({ probeResponses: ['garbage'] })
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const { result } = await runTask(brokenHarness, {
      mode: 'resize',
      files: [makeInput(inDir, 'photo.jpg')],
      outputDir: outDir,
      options: { mode: 'width', width: 500, noUpscale: false, format: 'jpg', quality: 75 }
    })
    const r = result as { outputs: unknown[]; failures: { code: string }[] }
    expect(r.outputs).toHaveLength(0)
    expect(firstOf(r.failures)).toMatchObject({ code: 'IT_PROBE_FAILED' })
  })

  it('abort → 不记失败项，已完成输出保留', async () => {
    const controller = new AbortController()
    const harness = createHarness({ abortAfterRun: true })
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    controller.abort()
    const { result } = await runTask(
      harness,
      compressPayload([makeInput(inDir, 'a.jpg')], outDir),
      {
        signal: controller.signal
      }
    )
    const r = result as { outputs: unknown[]; failures: unknown[] }
    expect(r.outputs).toHaveLength(0)
    expect(r.failures).toHaveLength(0)
  })

  it('输出目录不可创建（路径被文件占用）→ 批次级 IT_OUTPUT_WRITE_FAILED', async () => {
    const harness = createHarness()
    // 以已存在的「文件」充当输出目录：mkdirSync 报 EEXIST → 结构化错误
    const blocked = join(mkdtempSync(join(tmpdir(), 'lumin-it-block-')), 'occupied')
    roots.push(blocked)
    writeFileSync(blocked, 'not a dir')
    const { error } = await runTask(harness, compressPayload(['C:\\a.jpg'], blocked))
    expect(error).toMatchObject({ code: 'IT_OUTPUT_WRITE_FAILED' })
  })
})

describe('process effect（M40 调整）', () => {
  it('灰度：输出 .gray + hue=s=0 滤镜，不探测尺寸', async () => {
    const harness = createHarness()
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const { result, error } = await runTask(harness, {
      mode: 'effect',
      files: [makeInput(inDir, 'photo.jpg')],
      outputDir: outDir,
      options: { effect: 'grayscale', threshold: 128, quality: 75 }
    })
    expect(error).toBeUndefined()
    const r = result as { outputs: { output: string }[]; failures: unknown[] }
    expect(firstOf(r.outputs).output).toBe(join(outDir, 'photo.gray.jpg'))
    const call = findEncodeCall(harness)
    expect(call?.args).toContain('-vf')
    expect(call?.args).toContain('hue=s=0')
    expect(harness.calls.filter((c) => c.args?.[0] === '-hide_banner')).toHaveLength(0)
  })

  it('黑白二值：输出 .bw{阈值} + lut 阈值表达式', async () => {
    const harness = createHarness()
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const { result } = await runTask(harness, {
      mode: 'effect',
      files: [makeInput(inDir, 'photo.png')],
      outputDir: outDir,
      options: { effect: 'binary', threshold: 200, quality: 75 }
    })
    const r = result as { outputs: { output: string }[] }
    expect(firstOf(r.outputs).output).toBe(join(outDir, 'photo.bw200.png'))
    expect(findEncodeCall(harness)?.args).toContain("format=gray,lut=y='if(gt(val,200),255,0)'")
  })

  it('调色参数透传为 eq 滤镜段、缺省补 0 不改滤镜（M55 §4.55）', async () => {
    const harness = createHarness()
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const { result, error } = await runTask(harness, {
      mode: 'effect',
      files: [makeInput(inDir, 'photo.jpg')],
      outputDir: outDir,
      options: { effect: 'grayscale', threshold: 128, quality: 75, brightness: 40 }
    })
    expect(error).toBeUndefined()
    const r = result as { outputs: { output: string }[] }
    expect(firstOf(r.outputs).output).toBe(join(outDir, 'photo.gray.jpg'))
    const args = findEncodeCall(harness)?.args ?? []
    const vfIndex = args.indexOf('-vf')
    expect(vfIndex).toBeGreaterThan(-1)
    expect(args[vfIndex + 1]).toBe('eq=brightness=0.4,hue=s=0')
  })
})

describe('make-gif（M40）', () => {
  const gifPayload = (files: string[], outputDir: string) => ({
    files,
    outputDir,
    options: { durationMs: 500, loop: 0, width: 0 }
  })

  it('三帧 → 画布规划/帧率/循环/filter_complex + 结果体积', async () => {
    const harness = createHarness({
      outputBytes: 2048,
      probeResponses: [probeStderr(200, 100, 'png'), probeStderr(100, 100, 'png')]
    })
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const files = [makeInput(inDir, '1.png'), makeInput(inDir, '2.png'), makeInput(inDir, '3.png')]
    const { result, updates, error } = await runTask(harness, gifPayload(files, outDir), {
      action: 'make-gif'
    })
    expect(error).toBeUndefined()
    const r = result as {
      outputPath: string
      width: number
      height: number
      frames: number
      sizeBytes: number
    }
    expect(r.width).toBe(200)
    expect(r.height).toBe(200)
    expect(r.frames).toBe(3)
    expect(r.sizeBytes).toBe(2048)
    expect(r.outputPath).toMatch(/动图_\d{8}-\d{6}\.gif$/)
    const call = findEncodeCall(harness)
    expect(call?.args).toContain('-framerate')
    expect(call?.args).toContain('2')
    expect(call?.args).toContain('-loop')
    expect(call?.args).toContain('0')
    const graph = call?.args?.[call.args.indexOf('-filter_complex') + 1]
    expect(graph).toContain('concat=n=3:v=1:a=0')
    expect(graph).toContain('palettegen')
    expect(graph).toContain('paletteuse')
    // 进度：读取 1/3、2/3、3/3 + 编码 GIF
    expect(updates.filter((u) => u.kind === 'progress')).toHaveLength(4)
    expect(harness.settings.get('outputDir')).toBe(outDir)
  })

  it('画布超限 → IT_GIF_TOO_LARGE（不触编码）', async () => {
    const harness = createHarness({ probeResponses: [probeStderr(5000, 5000, 'png')] })
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const { error } = await runTask(harness, gifPayload([makeInput(inDir, 'big.png')], outDir), {
      action: 'make-gif'
    })
    expect(error).toMatchObject({ code: 'IT_GIF_TOO_LARGE' })
    expect(harness.calls.filter((c) => c.args?.[0] === '-y')).toHaveLength(0)
  })

  it('取消 → IT_CANCELLED；ffmpeg 失败 → 结构化错误', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const file = makeInput(inDir, 'a.png')
    const cancelled = await runTask(
      createHarness({ abortAfterRun: true }),
      gifPayload([file], outDir),
      { action: 'make-gif' }
    )
    expect(cancelled.error).toMatchObject({ code: 'IT_CANCELLED' })
    const failed = await runTask(
      createHarness({ ffmpegCode: 1, ffmpegStderr: 'No space left on device' }),
      gifPayload([file], outDir),
      { action: 'make-gif' }
    )
    expect(failed.error).toMatchObject({ code: 'IT_OUTPUT_WRITE_FAILED' })
  })

  it('非法入参 / 不支持的扩展名 → 结构化错误', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'lumin-it-out-'))
    roots.push(outDir)
    const harness = createHarness()
    const bad = await runTask(harness, { files: [], outputDir: outDir }, { action: 'make-gif' })
    expect(bad.error).toMatchObject({ code: 'INVALID_PAYLOAD' })
    const inDir = mkdtempSync(join(tmpdir(), 'lumin-it-in-'))
    roots.push(inDir)
    const exe = await runTask(harness, gifPayload([makeInput(inDir, 'a.exe')], outDir), {
      action: 'make-gif'
    })
    expect(exe.error).toMatchObject({ code: 'IT_FILE_UNSUPPORTED' })
  })
})
