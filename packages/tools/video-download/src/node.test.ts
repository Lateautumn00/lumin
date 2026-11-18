/**
 * @file node.ts 单测（假 runProcess 注入，不依赖外网与真实 yt-dlp）
 * @author cuilanchao
 * @date 2026-11-18
 * @description probe/start/mark-pause/history/history:clear 通道行为：引擎缺失、payload 校验、
 *              进度流式推送、最终路径捕获、abort → PAUSED/CANCELLED 区分、非零码 → FAILED + 结构化错误、
 *              历史读写与清空
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RunProcessOptions, RunProcessResult } from '@lumin/node-kit'
import type { IpcHandler, MainPluginContext, TaskHandler, TaskHandlerContext } from '@lumin/plugin-api'
import type { StructuredError, TaskUpdate } from '@lumin/shared'
import { manifest } from './manifest'
import { PROBE_TIMEOUT_MS, registerWith, type VideoDownloadDeps } from './node'
import type { HistoryEntry, StartPayload } from './schema'

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

/** 假 runProcess 行为定义：按序消费脚本，每项 = 结果 + 可选的 stdout 行流 */
interface RunScript {
  result: Partial<RunProcessResult>
  stdoutLines?: string[]
}

interface Harness {
  ipc: Map<string, IpcHandler<unknown, unknown>>
  tasks: Map<string, TaskHandler<unknown, unknown>>
  settings: Map<string, unknown>
  binariesRoot: string
  /** 每次 runProcess 调用收到的 options（断言参数组装用） */
  calls: RunProcessOptions[]
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createHarness(scripts: RunScript[], initialSettings: Record<string, unknown> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-vd-test-'))
  roots.push(root)
  const binariesRoot = join(root, 'binaries')
  const engineDir = join(binariesRoot, 'download')
  mkdirSync(engineDir, { recursive: true })
  writeFileSync(join(engineDir, 'yt-dlp.exe'), 'stub')

  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>(Object.entries(initialSettings))
  const calls: RunProcessOptions[] = []
  let scriptIndex = 0

  const deps: VideoDownloadDeps = {
    runProcess: (options) => {
      calls.push(options)
      const script = scripts[Math.min(scriptIndex, scripts.length - 1)]
      scriptIndex++
      const lines = script?.stdoutLines ?? []
      for (const line of lines) options.onStdoutLine?.(line)
      return Promise.resolve(okResult({ stdout: lines.join('\n'), ...script?.result }))
    },
    now: () => 1700000000000 + calls.length * 1000
  }

  const ctx: MainPluginContext = {
    toolId: manifest.id,
    manifest,
    registerIpc: <P, R>(action: string, handler: IpcHandler<P, R>): void => {
      ipc.set(action, handler as unknown as IpcHandler<unknown, unknown>)
    },
    registerTask: <P, R>(action: string, handler: TaskHandler<P, R>): void => {
      tasks.set(action, handler as unknown as TaskHandler<unknown, unknown>)
    },
    settings: {
      get: async <T>(key: string, defaultValue: T): Promise<T> =>
        settings.has(key) ? (settings.get(key) as T) : defaultValue,
      set: async (key, value) => {
        settings.set(key, value)
      }
    },
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    paths: { temp: join(root, 'temp'), userData: join(root, 'userData'), binaries: binariesRoot }
  }
  registerWith(ctx, deps)
  return { ipc, tasks, settings, binariesRoot, calls }
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
  options: { taskId?: string; signal?: AbortSignal } = {}
): Promise<{ result: unknown; updates: TaskUpdate[]; error?: StructuredError }> {
  const updates: TaskUpdate[] = []
  const taskCtx: TaskHandlerContext<unknown> = {
    toolId: manifest.id,
    action: 'start',
    payload,
    taskId: options.taskId ?? 'task-1',
    signal: options.signal ?? new AbortController().signal,
    emit: (update) => updates.push(update)
  }
  try {
    const result = await mustGet(harness.tasks, 'start')(taskCtx)
    return { result, updates }
  } catch (err) {
    return { result: undefined, updates, error: err as StructuredError }
  }
}

const outputDir = join(mkdtempSafe(), 'out')

const startPayload: StartPayload = {
  url: 'https://example.com/watch/1',
  preset: 'best',
  outputDir
}

function mkdtempPrefix(): string {
  return mkdtempSync(join(tmpdir(), 'lumin-vd-'))
}

function mkdtempSafe(): string {
  const dir = mkdtempPrefix()
  roots.push(dir)
  return dir
}

describe('probe', () => {
  it('引擎缺失 → VD_ENGINE_MISSING', async () => {
    const harness = createHarness([])
    rmSync(join(harness.binariesRoot, 'download'), { recursive: true, force: true })
    await expect(
      invokeIpc(harness, 'probe', { url: 'https://example.com/v/1' })
    ).rejects.toMatchObject({ code: 'VD_ENGINE_MISSING' })
  })

  it('payload 非 http(s) 链接 → VD_URL_INVALID', async () => {
    const harness = createHarness([])
    await expect(invokeIpc(harness, 'probe', { url: 'ftp://x' })).rejects.toMatchObject({
      code: 'VD_URL_INVALID'
    })
  })

  it('成功：-J JSON 投影 title/platform/duration/thumbnail，超时参数 20s', async () => {
    const harness = createHarness([
      {
        result: {
          stdout: JSON.stringify({
            title: '示例视频',
            webpage_url_domain: 'bilibili.com',
            duration: 123.4,
            thumbnail: 'https://img.example.com/1.jpg'
          })
        }
      }
    ])
    const result = (await invokeIpc(harness, 'probe', { url: 'https://example.com/v/1' })) as Record<
      string,
      unknown
    >
    expect(result).toEqual({
      title: '示例视频',
      platform: 'bilibili.com',
      durationSec: 123.4,
      thumbnailUrl: 'https://img.example.com/1.jpg'
    })
    expect(harness.calls[0]?.timeoutMs).toBe(PROBE_TIMEOUT_MS)
    expect(harness.calls[0]?.args).toEqual(['-J', '--no-playlist', 'https://example.com/v/1'])
  })

  it('非零退出码 → VD_PROBE_FAILED（detail = stderr 尾行）', async () => {
    const harness = createHarness([{ result: { code: 1, stderr: 'some error line' } }])
    await expect(
      invokeIpc(harness, 'probe', { url: 'https://example.com/v/1' })
    ).rejects.toMatchObject({ code: 'VD_PROBE_FAILED', detail: 'some error line' })
  })

  it('unsupported url 文案 → VD_UNSUPPORTED_PLATFORM', async () => {
    const harness = createHarness([{ result: { code: 1, stderr: 'Unsupported URL: https://x' } }])
    await expect(
      invokeIpc(harness, 'probe', { url: 'https://example.com/v/1' })
    ).rejects.toMatchObject({ code: 'VD_UNSUPPORTED_PLATFORM' })
  })

  it('stdout 不是合法 JSON → VD_PROBE_FAILED', async () => {
    const harness = createHarness([{ result: { stdout: 'not-json' } }])
    await expect(
      invokeIpc(harness, 'probe', { url: 'https://example.com/v/1' })
    ).rejects.toMatchObject({ code: 'VD_PROBE_FAILED', detail: '输出不是合法 JSON' })
  })
})

describe('mark-pause', () => {
  it('登记 taskId（后续 start abort 据此判 PAUSED）', async () => {
    const harness = createHarness([])
    await expect(invokeIpc(harness, 'mark-pause', { taskId: 'task-1' })).resolves.toEqual({})
  })

  it('payload 缺 taskId → INVALID_PAYLOAD', async () => {
    const harness = createHarness([])
    await expect(invokeIpc(harness, 'mark-pause', {})).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })
})

describe('start', () => {
  it('引擎缺失 → VD_ENGINE_MISSING 且不写历史', async () => {
    const harness = createHarness([])
    rmSync(join(harness.binariesRoot, 'download'), { recursive: true, force: true })
    const { error } = await runTask(harness, startPayload)
    expect(error).toMatchObject({ code: 'VD_ENGINE_MISSING' })
    expect(harness.settings.get('history')).toBeUndefined()
  })

  it('payload 非法 → VD_URL_INVALID', async () => {
    const harness = createHarness([])
    const { error } = await runTask(harness, { ...startPayload, url: 'notaurl' })
    expect(error).toMatchObject({ code: 'VD_URL_INVALID' })
  })

  it('输出目录不可创建（路径为普通文件）→ VD_OUTPUT_WRITE_FAILED', async () => {
    const dir = mkdtempSafe()
    const filePath = join(dir, 'occupied')
    writeFileSync(filePath, 'x')
    const harness = createHarness([])
    const { error } = await runTask(harness, { ...startPayload, outputDir: filePath })
    expect(error).toMatchObject({ code: 'VD_OUTPUT_WRITE_FAILED' })
  })

  it('成功：流式推送进度、捕获最终路径、历史 DONE + outputName', async () => {
    const finalPath = join(outputDir, '示例 [abc].mp4')
    const harness = createHarness([
      {
        result: {},
        stdoutLines: [
          'PROGRESS|1024|4096|512|10',
          'PROGRESS|2048|4096|512|6',
          finalPath
        ]
      }
    ])
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(finalPath, 'stub')
    const { updates, error } = await runTask(harness, startPayload)
    expect(error).toBeUndefined()
    expect(updates).toHaveLength(3)
    expect(updates[0]).toMatchObject({
      kind: 'progress',
      current: 1024,
      total: 4096,
      stage: 'download'
    })
    expect(updates[1]?.message).toBe('512 B/s · 剩余 0:06')

    const history = harness.settings.get('history') as HistoryEntry[]
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      id: 'task-1',
      status: 'DONE',
      preset: 'best',
      outputName: '示例 [abc].mp4',
      downloadedBytes: 2048
    })
    // 参数组装：进度模板 + ffmpeg-location + print 最终路径
    const args = harness.calls[0]?.args ?? []
    expect(args).toContain('after_move:filepath')
    expect(args).toContain('--continue')
  })

  it('abort 无 mark-pause → 历史 CANCELLED', async () => {
    const harness = createHarness([{ result: { aborted: true } }])
    mkdirSync(outputDir, { recursive: true })
    const { error } = await runTask(harness, startPayload)
    expect(error).toBeUndefined()
    const history = harness.settings.get('history') as HistoryEntry[]
    expect(history[0]?.status).toBe('CANCELLED')
  })

  it('abort 有 mark-pause → 历史 PAUSED（.part 保留可续传）', async () => {
    const harness = createHarness([{ result: { aborted: true } }])
    mkdirSync(outputDir, { recursive: true })
    await invokeIpc(harness, 'mark-pause', { taskId: 'task-1' })
    const { error } = await runTask(harness, startPayload)
    expect(error).toBeUndefined()
    const history = harness.settings.get('history') as HistoryEntry[]
    expect(history[0]?.status).toBe('PAUSED')
  })

  it('非零码 + unsupported → VD_UNSUPPORTED_PLATFORM 且历史 FAILED', async () => {
    const harness = createHarness([{ result: { code: 1, stderr: 'Unsupported URL: x' } }])
    mkdirSync(outputDir, { recursive: true })
    const { error } = await runTask(harness, startPayload)
    expect(error).toMatchObject({ code: 'VD_UNSUPPORTED_PLATFORM' })
    const history = harness.settings.get('history') as HistoryEntry[]
    expect(history[0]?.status).toBe('FAILED')
  })

  it('非零码普通失败 → VD_DOWNLOAD_FAILED', async () => {
    const harness = createHarness([{ result: { code: 1, stderr: 'HTTP Error 403' } }])
    mkdirSync(outputDir, { recursive: true })
    const { error } = await runTask(harness, startPayload)
    expect(error).toMatchObject({ code: 'VD_DOWNLOAD_FAILED', detail: 'HTTP Error 403' })
  })

  it('非结构化异常兜底包装 → VD_DOWNLOAD_FAILED', async () => {
    const dir = mkdtempSafe()
    const harness = createHarness([])
    mkdirSync(join(dir, 'out'), { recursive: true })
    harness.tasks.delete('start')
    // 重新注册一个 runProcess 抛非结构化异常的实例
    const settings = harness.settings
    const binariesRoot = harness.binariesRoot
    const ipc = new Map<string, IpcHandler<unknown, unknown>>()
    const tasks = new Map<string, TaskHandler<unknown, unknown>>()
    registerWith(
      {
        toolId: manifest.id,
        manifest,
        registerIpc: <P, R>(action: string, handler: IpcHandler<P, R>): void => {
          ipc.set(action, handler as unknown as IpcHandler<unknown, unknown>)
        },
        registerTask: <P, R>(action: string, handler: TaskHandler<P, R>): void => {
          tasks.set(action, handler as unknown as TaskHandler<unknown, unknown>)
        },
        settings: {
          get: async <T>(key: string, defaultValue: T): Promise<T> =>
            settings.has(key) ? (settings.get(key) as T) : defaultValue,
          set: async (key, value) => {
            settings.set(key, value)
          }
        },
        log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
        paths: { temp: dir, userData: dir, binaries: binariesRoot }
      },
      {
        runProcess: () => Promise.reject(new Error('boom')),
        now: () => 0
      }
    )
    const updates: TaskUpdate[] = []
    try {
      await mustGet(tasks, 'start')({
        toolId: manifest.id,
        action: 'start',
        payload: startPayload,
        taskId: 'task-9',
        signal: new AbortController().signal,
        emit: (update) => updates.push(update)
      } satisfies TaskHandlerContext<unknown>)
      expect.unreachable('应当抛错')
    } catch (err) {
      expect(err).toMatchObject({ code: 'VD_DOWNLOAD_FAILED', detail: 'boom' })
    }
  })
})

describe('history / history:clear', () => {
  it('history：坏条目丢弃 + RUNNING→FAILED 归一后返回', async () => {
    const entry = {
      id: 't1',
      url: 'https://example.com/v/1',
      title: 'a',
      preset: 'best',
      outputDir: 'E:\\out',
      status: 'RUNNING',
      startedAt: 1
    }
    const harness = createHarness([], { history: [entry, { junk: true }] })
    const result = (await invokeIpc(harness, 'history', {})) as { entries: HistoryEntry[] }
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.status).toBe('FAILED')
  })

  it('history:clear：清空 settings', async () => {
    const harness = createHarness(
      [],
      {
        history: [
          {
            id: 't1',
            url: 'https://example.com/v/1',
            title: 'a',
            preset: 'best',
            outputDir: 'E:\\out',
            status: 'DONE',
            startedAt: 1
          }
        ]
      }
    )
    await expect(invokeIpc(harness, 'history:clear', {})).resolves.toEqual({})
    const result = (await invokeIpc(harness, 'history', {})) as { entries: HistoryEntry[] }
    expect(result.entries).toEqual([])
  })
})
