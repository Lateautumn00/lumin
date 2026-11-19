/**
 * @file node.ts 单测（假 runProcess 注入，不依赖真实 ffmpeg）
 * @author cuilanchao
 * @date 2026-11-19
 * @description probe/config/process 通道行为：引擎缺失、批量部分失败、缺流校验、
 *              取消不记失败、超时/磁盘满归类、冲突重命名、截取区间非法、进度事件
 */
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
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
import { registerWith, type MediaConvertDeps } from './node'
import { MAX_FILE_BYTES } from './schema'

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

/** ffmpeg `-i` 探测 stderr 样例（时长 3.2s，含 h264 + aac） */
function probeStderr(duration = '00:00:03.20', withAudio = true): string {
  const lines = [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'C:\\x.mp4':",
    `  Duration: ${duration}, start: 0.000000, bitrate: 512 kb/s`,
    '  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 640x360, 25 fps, 25 tbr'
  ]
  if (withAudio) lines.push('  Stream #0:1[0x2](und): Audio: aac (LC), 44100 Hz, stereo, fltp')
  return lines.join('\n')
}

interface HarnessOptions {
  /** 探测返回 stderr 序列（用尽后回退默认） */
  probeResponses?: string[]
  /** ffmpeg 退出码 */
  ffmpegCode?: number
  /** ffmpeg stderr */
  ffmpegStderr?: string
  /** ffmpeg 执行后置 aborted（模拟取消杀树） */
  abortAfterRun?: boolean
  /** ffmpeg 执行后置 timedOut */
  timeoutAfterRun?: boolean
  /** 输出文件字节数 */
  outputBytes?: number
  /** 引擎目录是否预置 ffmpeg（默认预置） */
  withEngine?: boolean
  /** 输出目录预置的同名文件 */
  existingFiles?: string[]
  /** 探测终态覆盖（按探测序号依次生效，用于超时/取消） */
  probeOverrides?: Array<Partial<RunProcessResult>>
  /** 编码调用以该值 reject（模拟非结构化异常） */
  encodeReject?: unknown
  /** settings.set 抛出的异常（模拟持久化失败） */
  settingsSetError?: Error | string
  /** 编码期 stdout 行序列（默认 out_time_us + progress=end） */
  progressLines?: string[]
  /** 冻结时钟（now 恒为 0，用于验证进度节流抑制） */
  frozenClock?: boolean
}

interface Harness {
  ipc: Map<string, IpcHandler<unknown, unknown>>
  tasks: Map<string, TaskHandler<unknown, unknown>>
  settings: Map<string, unknown>
  root: string
  userData: string
  calls: RunProcessOptions[]
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createHarness(options: HarnessOptions = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-mc-test-'))
  roots.push(root)
  const binariesRoot = join(root, 'binaries')
  const engineDir = join(binariesRoot, 'download')
  const userData = join(root, 'userData')
  mkdirSync(userData, { recursive: true })
  if (options.withEngine !== false) {
    mkdirSync(engineDir, { recursive: true })
    writeFileSync(join(engineDir, 'ffmpeg.exe'), 'stub')
  }
  for (const name of options.existingFiles ?? []) {
    mkdirSync(join(userData, 'media'), { recursive: true })
    writeFileSync(join(userData, 'media', name), 'x')
  }

  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const calls: RunProcessOptions[] = []
  let probeIndex = 0
  let clock = 0

  const deps: MediaConvertDeps = {
    runProcess: (opts) => {
      calls.push(opts)
      const isProbe = opts.args?.[0] === '-hide_banner'
      if (isProbe) {
        const stderr = options.probeResponses?.[probeIndex] ?? probeStderr()
        const override = options.probeOverrides?.[probeIndex] ?? {}
        probeIndex++
        return Promise.resolve(okResult({ code: 1, stderr, ...override }))
      }
      if (options.encodeReject !== undefined) return Promise.reject(options.encodeReject)
      const output = opts.args?.[opts.args.length - 1]
      const code = options.ffmpegCode ?? 0
      if (typeof output === 'string' && code === 0 && options.abortAfterRun !== true) {
        writeFileSync(output, Buffer.alloc(options.outputBytes ?? 100, 1))
        // 进度行回调（真实 ffmpeg `-progress pipe:1` 输出形态）
        for (const line of options.progressLines ?? ['out_time_us=1000000', 'progress=end']) {
          opts.onStdoutLine?.(line)
        }
      }
      return Promise.resolve(
        okResult({
          code,
          stderr: options.ffmpegStderr ?? '',
          aborted: options.abortAfterRun ?? false,
          timedOut: options.timeoutAfterRun ?? false
        })
      )
    },
    now: () => {
      if (options.frozenClock !== true) clock += 500
      return clock
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
        if (options.settingsSetError !== undefined) throw options.settingsSetError
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
  return { ipc, tasks, settings, root, userData, calls }
}

function mustGet<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key)
  if (value === undefined) throw new Error(`缺少 handler：${String(key)}`)
  return value
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

/** 造一个假输入文件（探测走假 ffmpeg） */
function makeInput(dir: string, name: string, bytes = 1000): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, Buffer.alloc(bytes, 0))
  return path
}

/** 取首个编码调用（探测以 `-hide_banner` 首参区分；编码首参为 `-y`） */
function findEncodeCall(harness: Harness): RunProcessOptions | undefined {
  return harness.calls.find((call) => call.args?.[0] === '-y')
}

describe('probe', () => {
  it('引擎缺失 → MC_ENGINE_MISSING', async () => {
    const harness = createHarness({ withEngine: false })
    await expect(invokeIpc(harness, 'probe', { files: ['C:\\a.mp4'] })).rejects.toMatchObject({
      code: 'MC_ENGINE_MISSING'
    })
  })

  it('空文件列表 → INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expect(invokeIpc(harness, 'probe', { files: [] })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })

  it('成功项 + 损坏文件进 failures 不阻塞', async () => {
    const harness = createHarness({
      probeResponses: [probeStderr(), 'Invalid data found when processing input']
    })
    const dir = join(harness.root, 'in')
    const good = makeInput(dir, '样例 视频.mp4')
    const bad = makeInput(dir, '损坏.mp4')
    const result = (await invokeIpc(harness, 'probe', { files: [good, bad] })) as {
      items: Array<{ durationSec: number; video: unknown; audio: unknown }>
      failures: Array<{ code: string }>
    }
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.durationSec).toBeCloseTo(3.2, 3)
    expect(result.items[0]?.video).not.toBeNull()
    expect(result.items[0]?.audio).not.toBeNull()
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.code).toBe('MC_FILE_CORRUPT')
    expect(harness.calls.filter((call) => call.args?.[0] === '-hide_banner')).toHaveLength(2)
  })

  it('探测超时 → MC_PROBE_FAILED；取消 → MC_CANCELLED', async () => {
    const harness = createHarness({
      probeOverrides: [{ timedOut: true }, { aborted: true }]
    })
    const dir = join(harness.root, 'in')
    const a = makeInput(dir, 'a.mp4')
    const b = makeInput(dir, 'b.mp4')
    const timed = (await invokeIpc(harness, 'probe', { files: [a] })) as {
      failures: Array<{ code: string; message: string }>
    }
    expect(timed.failures[0]?.code).toBe('MC_PROBE_FAILED')
    const cancelled = (await invokeIpc(harness, 'probe', { files: [b] })) as {
      failures: Array<{ code: string }>
    }
    expect(cancelled.failures[0]?.code).toBe('MC_CANCELLED')
  })

  it('无法识别 → MC_PROBE_FAILED；仅时长无流 → MC_FILE_CORRUPT', async () => {
    const harness = createHarness({
      probeResponses: [
        'Unable to find a suitable output format',
        '  Duration: 00:00:10.00, start: 0.000000, bitrate: 0 kb/s'
      ]
    })
    const dir = join(harness.root, 'in')
    const a = makeInput(dir, 'a.mp4')
    const b = makeInput(dir, 'b.mp4')
    const result = (await invokeIpc(harness, 'probe', { files: [a, b] })) as {
      items: unknown[]
      failures: Array<{ code: string }>
    }
    expect(result.items).toHaveLength(0)
    expect(result.failures.map((failure) => failure.code)).toEqual([
      'MC_PROBE_FAILED',
      'MC_FILE_CORRUPT'
    ])
  })

  it('目录/无扩展名/超 4GB/不存在文件均进 failures', async () => {
    const harness = createHarness()
    const dir = join(harness.root, 'in')
    const sub = join(dir, 'folder.mp4')
    mkdirSync(sub, { recursive: true })
    const noExt = makeInput(dir, 'noext')
    const missing = join(dir, 'missing.mp4')
    const huge = makeInput(dir, 'huge.mp4')
    truncateSync(huge, MAX_FILE_BYTES + 1)
    const result = (await invokeIpc(harness, 'probe', {
      files: [sub, noExt, missing, huge]
    })) as { items: unknown[]; failures: Array<{ code: string; message: string }> }
    expect(result.items).toHaveLength(0)
    expect(result.failures.map((failure) => failure.code)).toEqual([
      'MC_FILE_UNSUPPORTED',
      'MC_FILE_UNSUPPORTED',
      'MC_FILE_UNSUPPORTED',
      'MC_FILE_UNSUPPORTED'
    ])
    expect(result.failures[2]?.message).toBe('文件不可读（不存在或被占用）')
  })
})

describe('config / set-output-dir', () => {
  it('默认 userData/media；保存后回读', async () => {
    const harness = createHarness()
    const initial = (await invokeIpc(harness, 'config', {})) as { outputDir: string }
    expect(initial.outputDir).toBe(join(harness.userData, 'media'))
    await invokeIpc(harness, 'set-output-dir', { outputDir: 'C:\\out' })
    expect(harness.settings.get('outputDir')).toBe('C:\\out')
  })

  it('set-output-dir 非法入参 → INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expect(invokeIpc(harness, 'set-output-dir', { outputDir: '' })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })
})

describe('process', () => {
  it('转码成功：命名、参数、进度与结果', async () => {
    const harness = createHarness()
    const input = makeInput(join(harness.root, 'in'), 'demo.mp4')
    const outputDir = join(harness.root, 'out')
    const { result, updates } = await runTask(harness, {
      mode: 'transcode',
      files: [input],
      outputDir,
      options: { format: 'webm', quality: 'medium' }
    })
    const done = result as { outputs: Array<{ output: string; durationSec: number }>; failures: [] }
    expect(done.failures).toEqual([])
    expect(done.outputs).toHaveLength(1)
    expect(done.outputs[0]?.output).toBe(join(outputDir, 'demo.webm'))
    expect(done.outputs[0]?.durationSec).toBeCloseTo(3.2, 3)
    const encode = findEncodeCall(harness)
    expect(encode?.args?.join(' ')).toContain('libvpx-vp9')
    expect(updates.some((u) => u.kind === 'progress' && u.current === 100)).toBe(true)
  })

  it('批量部分失败：正常项与失败项分别汇总', async () => {
    const harness = createHarness({
      probeResponses: [probeStderr(), 'moov atom not found']
    })
    const dir = join(harness.root, 'in')
    const good = makeInput(dir, 'good.mov')
    const bad = makeInput(dir, 'bad.mov')
    const { result } = await runTask(harness, {
      mode: 'compress',
      files: [good, bad],
      outputDir: join(harness.root, 'out'),
      options: { level: 'medium', maxHeight: 720 }
    })
    const done = result as { outputs: unknown[]; failures: Array<{ input: string; code: string }> }
    expect(done.outputs).toHaveLength(1)
    expect(done.failures).toHaveLength(1)
    expect(done.failures[0]?.input).toBe(bad)
    expect(done.failures[0]?.code).toBe('MC_FILE_CORRUPT')
  })

  it('缺音频轨提取音频 → MC_NO_STREAM', async () => {
    const harness = createHarness({ probeResponses: [probeStderr('00:00:03.20', false)] })
    const input = makeInput(join(harness.root, 'in'), 'silent.mp4')
    const { result } = await runTask(harness, {
      mode: 'extract-audio',
      files: [input],
      outputDir: join(harness.root, 'out'),
      options: { format: 'mp3', bitrate: 192 }
    })
    const done = result as { outputs: unknown[]; failures: Array<{ code: string }> }
    expect(done.outputs).toHaveLength(0)
    expect(done.failures[0]?.code).toBe('MC_NO_STREAM')
  })

  it('音频扩展名提交视频模式 → MC_NO_STREAM', async () => {
    const harness = createHarness()
    const input = makeInput(join(harness.root, 'in'), 'voice.mp3')
    const { result } = await runTask(harness, {
      mode: 'transcode',
      files: [input],
      outputDir: join(harness.root, 'out'),
      options: { format: 'mp4', quality: 'medium' }
    })
    const done = result as { failures: Array<{ code: string }> }
    expect(done.failures[0]?.code).toBe('MC_NO_STREAM')
  })

  it('取消：不记失败项、不产出结果', async () => {
    const harness = createHarness({ abortAfterRun: true })
    const input = makeInput(join(harness.root, 'in'), 'demo.mp4')
    const { result } = await runTask(harness, {
      mode: 'transcode',
      files: [input],
      outputDir: join(harness.root, 'out'),
      options: { format: 'mp4', quality: 'medium' }
    })
    const done = result as { outputs: unknown[]; failures: unknown[] }
    expect(done.outputs).toEqual([])
    expect(done.failures).toEqual([])
  })

  it('超时 → MC_TIMEOUT；磁盘满 → MC_OUTPUT_WRITE_FAILED', async () => {
    const timeoutHarness = createHarness({ timeoutAfterRun: true, ffmpegCode: 1 })
    const inputA = makeInput(join(timeoutHarness.root, 'in'), 'a.mp4')
    const timed = await runTask(timeoutHarness, {
      mode: 'transcode',
      files: [inputA],
      outputDir: join(timeoutHarness.root, 'out'),
      options: { format: 'mp4', quality: 'low' }
    })
    expect((timed.result as { failures: Array<{ code: string }> }).failures[0]?.code).toBe(
      'MC_TIMEOUT'
    )

    const fullHarness = createHarness({
      ffmpegCode: 1,
      ffmpegStderr: 'av_interleaved_write_frame(): No space left on device'
    })
    const inputB = makeInput(join(fullHarness.root, 'in'), 'b.mp4')
    const full = await runTask(fullHarness, {
      mode: 'transcode',
      files: [inputB],
      outputDir: join(fullHarness.root, 'out'),
      options: { format: 'mp4', quality: 'low' }
    })
    expect((full.result as { failures: Array<{ code: string }> }).failures[0]?.code).toBe(
      'MC_OUTPUT_WRITE_FAILED'
    )
  })

  it('输出目录不可用（路径是文件）→ 批次级 MC_OUTPUT_WRITE_FAILED', async () => {
    const harness = createHarness()
    const input = makeInput(join(harness.root, 'in'), 'demo.mp4')
    const blocker = join(harness.root, 'blocker')
    writeFileSync(blocker, 'x')
    const { error } = await runTask(harness, {
      mode: 'transcode',
      files: [input],
      outputDir: blocker,
      options: { format: 'mp4', quality: 'low' }
    })
    expect(error?.code).toBe('MC_OUTPUT_WRITE_FAILED')
  })

  it('截取区间非法 → 批次级 MC_PARAM_INVALID', async () => {
    const harness = createHarness()
    const input = makeInput(join(harness.root, 'in'), 'demo.mp4')
    const { error } = await runTask(harness, {
      mode: 'trim',
      files: [input],
      outputDir: join(harness.root, 'out'),
      options: { startSec: 5, endSec: 5, fastCopy: false }
    })
    expect(error?.code).toBe('MC_PARAM_INVALID')
  })

  it('冲突自动重命名（已有输出目录同名文件）', async () => {
    const harness = createHarness({ existingFiles: ['demo.webm'] })
    const input = makeInput(join(harness.root, 'in'), 'demo.mp4')
    const outputDir = join(harness.root, 'out')
    // 预置同名输出文件到目标目录
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(join(outputDir, 'demo.webm'), 'x')
    const { result } = await runTask(harness, {
      mode: 'transcode',
      files: [input],
      outputDir,
      options: { format: 'webm', quality: 'medium' }
    })
    const done = result as { outputs: Array<{ output: string }> }
    expect(done.outputs[0]?.output).toBe(join(outputDir, 'demo (1).webm'))
  })

  it('截取成功（精确重编码）：命名与目标时长', async () => {
    const harness = createHarness()
    const input = makeInput(join(harness.root, 'in'), 'demo.mp4')
    const outputDir = join(harness.root, 'out')
    const { result } = await runTask(harness, {
      mode: 'trim',
      files: [input],
      outputDir,
      options: { startSec: 0, endSec: 2, fastCopy: false }
    })
    const done = result as { outputs: Array<{ output: string; durationSec: number }>; failures: [] }
    expect(done.failures).toEqual([])
    expect(done.outputs[0]?.output).toBe(join(outputDir, 'demo.cut_000000-000002.mp4'))
    expect(done.outputs[0]?.durationSec).toBe(2)
    expect(findEncodeCall(harness)?.args?.join(' ')).toContain('libx264')
  })

  it('截取快速复制；起点超出源时长 → 单文件 MC_PARAM_INVALID', async () => {
    const fast = createHarness()
    const input = makeInput(join(fast.root, 'in'), 'demo.mp4')
    const ok = await runTask(fast, {
      mode: 'trim',
      files: [input],
      outputDir: join(fast.root, 'out'),
      options: { startSec: 0.5, endSec: 2, fastCopy: true }
    })
    const done = ok.result as { outputs: Array<{ output: string }> }
    expect(done.outputs[0]?.output).toBe(join(fast.root, 'out', 'demo.cut_000001-000002.mp4'))
    expect(findEncodeCall(fast)?.args?.join(' ')).toContain('-c copy')

    const over = createHarness()
    const input2 = makeInput(join(over.root, 'in'), 'demo.mp4')
    const bad = await runTask(over, {
      mode: 'trim',
      files: [input2],
      outputDir: join(over.root, 'out'),
      options: { startSec: 10, endSec: 12, fastCopy: false }
    })
    const failed = bad.result as { outputs: unknown[]; failures: Array<{ code: string }> }
    expect(failed.outputs).toHaveLength(0)
    expect(failed.failures[0]?.code).toBe('MC_PARAM_INVALID')
  })

  it('提取音频成功（mp3）', async () => {
    const harness = createHarness()
    const input = makeInput(join(harness.root, 'in'), 'demo.mp4')
    const outputDir = join(harness.root, 'out')
    const { result } = await runTask(harness, {
      mode: 'extract-audio',
      files: [input],
      outputDir,
      options: { format: 'mp3', bitrate: 192 }
    })
    const done = result as { outputs: Array<{ output: string; durationSec: number }>; failures: [] }
    expect(done.failures).toEqual([])
    expect(done.outputs[0]?.output).toBe(join(outputDir, 'demo.audio.mp3'))
    expect(done.outputs[0]?.durationSec).toBeCloseTo(3.2, 3)
    expect(findEncodeCall(harness)?.args?.join(' ')).toContain('libmp3lame')
  })

  it('视频模式遇仅音频流 → MC_NO_STREAM', async () => {
    const harness = createHarness({
      probeResponses: [
        '  Duration: 00:00:10.00, start: 0.0\n  Stream #0:0: Audio: mp3, 48000 Hz, stereo'
      ]
    })
    const input = makeInput(join(harness.root, 'in'), 'audio-only.mp4')
    const { result } = await runTask(harness, {
      mode: 'compress',
      files: [input],
      outputDir: join(harness.root, 'out'),
      options: { level: 'high', maxHeight: 0 }
    })
    const done = result as { failures: Array<{ code: string }> }
    expect(done.failures[0]?.code).toBe('MC_NO_STREAM')
  })

  it('源时长未知：非截取目标时长为 0，截取退化为入参区间', async () => {
    const noDuration = '  Stream #0:0: Video: h264, yuv420p, 640x360'
    const trans = createHarness({ probeResponses: [noDuration] })
    const inputA = makeInput(join(trans.root, 'in'), 'demo.mp4')
    const transcoded = await runTask(trans, {
      mode: 'transcode',
      files: [inputA],
      outputDir: join(trans.root, 'out'),
      options: { format: 'mkv', quality: 'high' }
    })
    const done = transcoded.result as { outputs: Array<{ output: string; durationSec: number }> }
    expect(done.outputs[0]?.output).toBe(join(trans.root, 'out', 'demo.mkv'))
    expect(done.outputs[0]?.durationSec).toBe(0)

    const trim = createHarness({ probeResponses: [noDuration] })
    const inputB = makeInput(join(trim.root, 'in'), 'demo.mp4')
    const trimmed = await runTask(trim, {
      mode: 'trim',
      files: [inputB],
      outputDir: join(trim.root, 'out'),
      options: { startSec: 1, endSec: 3, fastCopy: false }
    })
    const trimmedDone = trimmed.result as {
      outputs: Array<{ output: string; durationSec: number }>
    }
    expect(trimmedDone.outputs[0]?.durationSec).toBe(2)
    expect(trimmedDone.outputs[0]?.output).toBe(
      join(trim.root, 'out', 'demo.cut_000001-000003.mp4')
    )
  })

  it('无扩展名/目录输入 → 单文件 MC_FILE_UNSUPPORTED', async () => {
    const harness = createHarness()
    const dir = join(harness.root, 'in')
    const noExt = makeInput(dir, 'noext')
    const asDir = join(dir, 'folder.mp4')
    mkdirSync(asDir, { recursive: true })
    const { result } = await runTask(harness, {
      mode: 'transcode',
      files: [noExt, asDir],
      outputDir: join(harness.root, 'out'),
      options: { format: 'mp4', quality: 'low' }
    })
    const done = result as { outputs: unknown[]; failures: Array<{ code: string }> }
    expect(done.outputs).toHaveLength(0)
    expect(done.failures.map((failure) => failure.code)).toEqual([
      'MC_FILE_UNSUPPORTED',
      'MC_FILE_UNSUPPORTED'
    ])
  })

  it('输入不存在 → 非结构化异常转 MC_FILE_CORRUPT 失败项', async () => {
    const harness = createHarness()
    const missing = join(harness.root, 'in', 'missing.mp4')
    const { result } = await runTask(harness, {
      mode: 'transcode',
      files: [missing],
      outputDir: join(harness.root, 'out'),
      options: { format: 'mp4', quality: 'low' }
    })
    const done = result as { failures: Array<{ code: string; message: string }> }
    expect(done.failures[0]?.code).toBe('MC_FILE_CORRUPT')
    expect(done.failures[0]?.message).toContain('ENOENT')
  })

  it('编码非 Error 异常 → MC_FILE_CORRUPT 且 message 为空', async () => {
    const harness = createHarness({ encodeReject: 'boom' })
    const input = makeInput(join(harness.root, 'in'), 'demo.mp4')
    const { result } = await runTask(harness, {
      mode: 'transcode',
      files: [input],
      outputDir: join(harness.root, 'out'),
      options: { format: 'mp4', quality: 'low' }
    })
    const done = result as { failures: Array<{ code: string; message: string }> }
    expect(done.failures[0]?.code).toBe('MC_FILE_CORRUPT')
    expect(done.failures[0]?.message).toBe('')
  })

  it('开始前已取消 → 空批次且不调用编码', async () => {
    const harness = createHarness()
    const input = makeInput(join(harness.root, 'in'), 'demo.mp4')
    const controller = new AbortController()
    controller.abort()
    const { result } = await runTask(
      harness,
      {
        mode: 'transcode',
        files: [input],
        outputDir: join(harness.root, 'out'),
        options: { format: 'mp4', quality: 'low' }
      },
      { signal: controller.signal }
    )
    const done = result as { outputs: unknown[]; failures: unknown[] }
    expect(done.outputs).toEqual([])
    expect(done.failures).toEqual([])
    expect(findEncodeCall(harness)).toBeUndefined()
  })

  it('进度节流：同百分比且未过 200ms 抑制；end-only 行直推完成', async () => {
    const harness = createHarness({
      frozenClock: true,
      progressLines: ['out_time_us=1000000', 'out_time_us=1000000', 'progress=end']
    })
    const input = makeInput(join(harness.root, 'in'), 'demo.mp4')
    const { updates } = await runTask(harness, {
      mode: 'transcode',
      files: [input],
      outputDir: join(harness.root, 'out'),
      options: { format: 'mp4', quality: 'low' }
    })
    const progress = updates.filter((update) => update.kind === 'progress')
    expect(progress.some((update) => update.current === 100)).toBe(true)
    expect(progress.length).toBeGreaterThanOrEqual(2)
  })

  it('settings 持久化异常：Error → MC_FILE_CORRUPT；非 Error → 原样抛出', async () => {
    const errorHarness = createHarness({ settingsSetError: new Error('磁盘只读') })
    const inputA = makeInput(join(errorHarness.root, 'in'), 'demo.mp4')
    const failed = await runTask(errorHarness, {
      mode: 'transcode',
      files: [inputA],
      outputDir: join(errorHarness.root, 'out'),
      options: { format: 'mp4', quality: 'low' }
    })
    expect(failed.error?.code).toBe('MC_FILE_CORRUPT')

    const rawHarness = createHarness({ settingsSetError: 'raw failure' })
    const inputB = makeInput(join(rawHarness.root, 'in'), 'demo.mp4')
    const raw = await runTask(rawHarness, {
      mode: 'transcode',
      files: [inputB],
      outputDir: join(rawHarness.root, 'out'),
      options: { format: 'mp4', quality: 'low' }
    })
    expect(raw.error).toBe('raw failure')
  })

  it('process 入参非法 → INVALID_PAYLOAD；引擎缺失 → MC_ENGINE_MISSING', async () => {
    const invalid = await runTask(createHarness(), { mode: 'nope' })
    expect(invalid.error?.code).toBe('INVALID_PAYLOAD')

    const noEngine = createHarness({ withEngine: false })
    const input = makeInput(join(noEngine.root, 'in'), 'demo.mp4')
    const missing = await runTask(noEngine, {
      mode: 'transcode',
      files: [input],
      outputDir: join(noEngine.root, 'out'),
      options: { format: 'mp4', quality: 'medium' }
    })
    expect(missing.error?.code).toBe('MC_ENGINE_MISSING')
  })
})
