/**
 * @file node.ts 单测（假 runProcess 注入，不依赖外网与真实 yt-dlp）
 * @author cuilanchao
 * @date 2026-11-19
 * @description probe/start/mark-pause/history/history:clear/cookie:* 通道行为：引擎缺失、payload 校验、
 *              进度流式推送、最终路径捕获、abort → PAUSED/CANCELLED 区分、非零码 → FAILED + 结构化错误、
 *              历史读写与清空、Cookie 加密存储/透传/脱敏/浏览器导入（spec §9）
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunProcessOptions, RunProcessResult } from '@lumin/node-kit'
import type {
  IpcHandler,
  MainPluginContext,
  TaskHandler,
  TaskHandlerContext
} from '@lumin/plugin-api'
import type { StructuredError, TaskUpdate } from '@lumin/shared'
import { manifest } from '../manifest'
import { importBrowserCookies } from './browser-cookies'
import { PROBE_TIMEOUT_MS, registerMain, registerWith, type VideoDownloadDeps } from './node'
import type { HistoryEntry, StartPayload } from './schema'
import type { NetscapeCookieLine } from './cookies'

// import-browser 真实浏览器读取由 browser-cookies.test.ts 覆盖，此文件 mock 统一入口测通道行为
vi.mock('./browser-cookies', () => ({ importBrowserCookies: vi.fn() }))

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

/** 假 runProcess 行为定义：按序消费脚本，每项 = 结果 + 可选的 stdout/stderr 行流 */
interface RunScript {
  result: Partial<RunProcessResult>
  stdoutLines?: string[]
  stderrLines?: string[]
}

interface Harness {
  ipc: Map<string, IpcHandler<unknown, unknown>>
  tasks: Map<string, TaskHandler<unknown, unknown>>
  settings: Map<string, unknown>
  binariesRoot: string
  /** 每次 runProcess 调用收到的 options（断言参数组装用） */
  calls: RunProcessOptions[]
  /** runProcess 执行瞬间 --cookies 指向文件的内容快照（终态文件已删，断言用） */
  cookieSnapshots: string[]
  /** 壳 temp 目录（临时 cookie 文件断言用） */
  temp: string
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createHarness(
  scripts: RunScript[],
  initialSettings: Record<string, unknown> = {},
  options: { secure?: boolean } = {}
): Harness {
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
  const cookieSnapshots: string[] = []
  let scriptIndex = 0

  const deps: VideoDownloadDeps = {
    runProcess: (options) => {
      calls.push(options)
      // 执行瞬间快照 --cookies 临时文件内容（任务/probe 终态即删除）
      const cfIndex = options.args?.indexOf('--cookies') ?? -1
      if (cfIndex >= 0) {
        const cf = options.args?.[cfIndex + 1]
        cookieSnapshots.push(
          cf !== undefined && existsSync(cf) ? readFileSync(cf, 'utf8') : '<missing>'
        )
      }
      const script = scripts[Math.min(scriptIndex, scripts.length - 1)]
      scriptIndex++
      const stdoutLines = script?.stdoutLines ?? []
      const stderrLines = script?.stderrLines ?? []
      for (const line of stdoutLines) options.onStdoutLine?.(line)
      for (const line of stderrLines) options.onStderrLine?.(line)
      return Promise.resolve(
        okResult({
          stdout: stdoutLines.join('\n'),
          stderr: stderrLines.join('\n'),
          ...script?.result
        })
      )
    },
    now: () => 1700000000000 + calls.length * 1000,
    hasSqlite: () => false
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
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    paths: { temp: join(root, 'temp'), userData: join(root, 'userData'), binaries: binariesRoot },
    // 假安全存储：base64 明文映射（断言「存储密文 ≠ 明文」用）；options.secure=false 模拟不可用
    secure:
      options.secure === false
        ? undefined
        : {
            isEncryptionAvailable: () => true,
            encryptString: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
            decryptString: (cipher) => Buffer.from(cipher, 'base64').toString('utf8')
          }
  }
  registerWith(ctx, deps)
  return { ipc, tasks, settings, binariesRoot, calls, cookieSnapshots, temp: join(root, 'temp') }
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
  options: { taskId?: string; signal?: AbortSignal; action?: string } = {}
): Promise<{ result: unknown; updates: TaskUpdate[]; error?: StructuredError }> {
  const updates: TaskUpdate[] = []
  const taskCtx: TaskHandlerContext<unknown> = {
    toolId: manifest.id,
    action: options.action ?? 'start',
    payload,
    taskId: options.taskId ?? 'task-1',
    signal: options.signal ?? new AbortController().signal,
    emit: (update) => updates.push(update)
  }
  try {
    const result = await mustGet(harness.tasks, options.action ?? 'start')(taskCtx)
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
    const result = (await invokeIpc(harness, 'probe', {
      url: 'https://example.com/v/1'
    })) as Record<string, unknown>
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
        stdoutLines: ['PROGRESS|1024|4096|512|10', 'PROGRESS|2048|4096|512|6', finalPath]
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

  it('成功：进度行走 stderr（真实引擎主路径）也能推送进度并计入历史', async () => {
    const finalPath = join(outputDir, 'stderr 产物.mp4')
    const harness = createHarness([
      {
        result: {},
        stderrLines: ['PROGRESS|4096|8192|1024|4'],
        stdoutLines: [finalPath]
      }
    ])
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(finalPath, 'stub')
    const { updates, error } = await runTask(harness, startPayload)
    expect(error).toBeUndefined()
    expect(updates).toEqual([
      expect.objectContaining({ kind: 'progress', current: 4096, total: 8192, stage: 'download' }),
      expect.objectContaining({ kind: 'progress', current: 1, total: 1, stage: 'finish' })
    ])
    const history = harness.settings.get('history') as HistoryEntry[]
    expect(history[0]).toMatchObject({ status: 'DONE', downloadedBytes: 4096 })
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
        log: {
          debug: () => undefined,
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined
        },
        paths: { temp: dir, userData: dir, binaries: binariesRoot }
      },
      {
        runProcess: () => Promise.reject(new Error('boom')),
        now: () => 0,
        hasSqlite: () => false
      }
    )
    const updates: TaskUpdate[] = []
    try {
      await mustGet(
        tasks,
        'start'
      )({
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
    const harness = createHarness([], {
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
    })
    await expect(invokeIpc(harness, 'history:clear', {})).resolves.toEqual({})
    const result = (await invokeIpc(harness, 'history', {})) as { entries: HistoryEntry[] }
    expect(result.entries).toEqual([])
  })
})

describe('cookie 通道（spec §9）', () => {
  const BILIBILI_URL = 'https://www.bilibili.com/video/BV1GJ411x7h7/'

  it('cookie:set：加密落存储（密文 ≠ 明文）并返回条数', async () => {
    const harness = createHarness([])
    const result = (await invokeIpc(harness, 'cookie:set', {
      platform: 'bilibili',
      raw: 'a=1; b=2'
    })) as { cookieCount: number; dropped: number }
    expect(result).toEqual({ cookieCount: 2, dropped: 0 })
    const stored = harness.settings.get('cookies.bilibili') as {
      cipher: string
      cookieCount: number
    }
    expect(stored.cookieCount).toBe(2)
    expect(stored.cipher).not.toContain('a=1')
    expect(Buffer.from(stored.cipher, 'base64').toString('utf8')).toBe('a=1; b=2')
  })

  it('cookie:set：全非法输入 → VD_COOKIE_FORMAT_INVALID', async () => {
    const harness = createHarness([])
    await expect(
      invokeIpc(harness, 'cookie:set', { platform: 'douyin', raw: 'garbage' })
    ).rejects.toMatchObject({
      code: 'VD_COOKIE_FORMAT_INVALID'
    })
  })

  it('cookie:set：secure 不可用 → VD_COOKIE_STORE_UNAVAILABLE', async () => {
    const harness = createHarness([], {}, { secure: false })
    await expect(
      invokeIpc(harness, 'cookie:set', { platform: 'douyin', raw: 'a=1' })
    ).rejects.toMatchObject({
      code: 'VD_COOKIE_STORE_UNAVAILABLE'
    })
  })

  it('cookie:list：三平台脱敏条目（仅条数/时间）', async () => {
    const harness = createHarness([], {
      'cookies.douyin': {
        cipher: Buffer.from('a=1').toString('base64'),
        cookieCount: 1,
        updatedAt: 42
      }
    })
    const result = (await invokeIpc(harness, 'cookie:list', {})) as {
      items: Array<{ platform: string; cookieCount: number; updatedAt?: number }>
    }
    expect(result.items).toEqual([
      { platform: 'douyin', cookieCount: 1, updatedAt: 42 },
      { platform: 'bilibili', cookieCount: 0 },
      { platform: 'youtube', cookieCount: 0 }
    ])
    expect(JSON.stringify(result)).not.toContain('a=1')
  })

  it('cookie:remove：删除存储条目', async () => {
    const harness = createHarness([], {
      'cookies.douyin': { cipher: 'x', cookieCount: 1, updatedAt: 1 }
    })
    await expect(invokeIpc(harness, 'cookie:remove', { platform: 'douyin' })).resolves.toEqual({})
    expect(harness.settings.get('cookies.douyin')).toBeNull()
  })

  it('probe：URL 平台已配 cookie → args 含 --cookies + 临时文件，结束后删除', async () => {
    const harness = createHarness([
      {
        result: {},
        stdoutLines: ['{"title":"t","webpage_url_domain":"bilibili.com","duration":1}']
      }
    ])
    await invokeIpc(harness, 'cookie:set', { platform: 'bilibili', raw: 'SESSDATA=xyz' })
    await invokeIpc(harness, 'probe', { url: BILIBILI_URL })
    const cookieFile = harness.calls[0]?.args?.[harness.calls[0].args.indexOf('--cookies') + 1]
    expect(cookieFile).toContain('vd-cookie-probe-')
    expect(harness.cookieSnapshots[0]).toContain('SESSDATA\txyz') // Netscape 行（TAB 分隔）
    expect(existsSync(cookieFile ?? '')).toBe(false) // 终态清理
  })

  it('probe：URL 平台未配 cookie → 无 --cookies', async () => {
    const harness = createHarness([
      {
        result: {},
        stdoutLines: ['{"title":"t","webpage_url_domain":"bilibili.com","duration":1}']
      }
    ])
    await invokeIpc(harness, 'probe', { url: BILIBILI_URL })
    expect(harness.calls[0]?.args).not.toContain('--cookies')
  })

  it('start：平台 cookie 透传 + 任务终态删除临时文件', async () => {
    const harness = createHarness([
      {
        result: {},
        stderrLines: ['PROGRESS|10|100|1024|1'],
        stdoutLines: [join(outputDir, 'done.mp4')]
      }
    ])
    await invokeIpc(harness, 'cookie:set', { platform: 'bilibili', raw: 'SESSDATA=xyz' })
    mkdirSync(harness.temp, { recursive: true })
    const before = readdirSync(harness.temp)
    const { error } = await runTask(
      harness,
      { ...startPayload, url: BILIBILI_URL },
      { taskId: 'task-c' }
    )
    expect(error).toBeUndefined()
    const startCall = harness.calls[0]
    expect(startCall?.args).toContain('--cookies')
    const cookieFile = startCall?.args?.[startCall.args.indexOf('--cookies') + 1]
    expect(existsSync(cookieFile ?? '')).toBe(false)
    expect(readdirSync(harness.temp).length).toBe(before.length)
  })

  it('cookie:import-browser：secure 不可用 → VD_COOKIE_STORE_UNAVAILABLE（真实读取路径由 browser-cookies/e2e 覆盖）', async () => {
    const harness = createHarness([], {}, { secure: false })
    const { error } = await runTask(
      harness,
      { platform: 'douyin', browser: 'firefox' },
      { action: 'cookie:import-browser', taskId: 'task-ck' }
    )
    expect(error).toMatchObject({ code: 'VD_COOKIE_STORE_UNAVAILABLE' })
  })

  it('cookie:import-browser：payload 非法 → INVALID_PAYLOAD', async () => {
    const harness = createHarness([])
    const { error } = await runTask(
      harness,
      { platform: 'nope' },
      { action: 'cookie:import-browser' }
    )
    expect(error).toMatchObject({ code: 'INVALID_PAYLOAD' })
  })

  it('cookie:import-browser：读取成功 → 三段 progress + Netscape 文本加密落存储', async () => {
    vi.mocked(importBrowserCookies).mockResolvedValueOnce([
      {
        domain: '.douyin.com',
        includeSubdomains: true,
        path: '/',
        secure: true,
        expires: 1893456000,
        name: 'sessionid',
        value: 's1'
      },
      {
        domain: '.douyin.com',
        includeSubdomains: true,
        path: '/',
        secure: true,
        expires: 1893456000,
        name: 'passid',
        value: 'p1'
      }
    ] satisfies NetscapeCookieLine[])
    const harness = createHarness([])
    const { result, updates, error } = await runTask(
      harness,
      { platform: 'douyin', browser: 'firefox' },
      { action: 'cookie:import-browser', taskId: 'task-imp' }
    )
    expect(error).toBeUndefined()
    expect(result).toEqual({ cookieCount: 2 })
    expect(updates.map((u) => (u.kind === 'progress' ? u.current : -1))).toEqual([0, 2, 3])
    const stored = harness.settings.get('cookies.douyin') as { cipher: string; cookieCount: number }
    expect(stored.cookieCount).toBe(2)
    // 密文可解回 Netscape 文本（TAB 分隔），不含明文字段名泄露风险仅限存储层
    expect(Buffer.from(stored.cipher, 'base64').toString('utf8')).toContain('sessionid\ts1')
  })

  it('cookie:import-browser：浏览器读取失败（Error）→ 包 VD_COOKIE_IMPORT_FAILED', async () => {
    vi.mocked(importBrowserCookies).mockRejectedValueOnce(
      new Error('未找到 Firefox cookies.sqlite')
    )
    const harness = createHarness([])
    const { error } = await runTask(
      harness,
      { platform: 'douyin', browser: 'firefox' },
      { action: 'cookie:import-browser' }
    )
    expect(error).toMatchObject({
      code: 'VD_COOKIE_IMPORT_FAILED',
      detail: '未找到 Firefox cookies.sqlite'
    })
  })

  it('cookie:import-browser：结构化错误原样透传（不再包装）', async () => {
    vi.mocked(importBrowserCookies).mockRejectedValueOnce({
      code: 'VD_COOKIE_FORMAT_INVALID',
      message: '格式无效'
    })
    const harness = createHarness([])
    const { error } = await runTask(
      harness,
      { platform: 'douyin', browser: 'firefox' },
      { action: 'cookie:import-browser' }
    )
    expect(error).toMatchObject({ code: 'VD_COOKIE_FORMAT_INVALID' })
  })
})

describe('registerMain（生产入口）', () => {
  it('走默认 deps（node:sqlite 探测容错）注册全部通道', () => {
    const ipc = new Map<string, IpcHandler<unknown, unknown>>()
    const tasks = new Map<string, TaskHandler<unknown, unknown>>()
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
        get: async <T>(_key: string, defaultValue: T): Promise<T> => defaultValue,
        set: async () => undefined
      },
      log: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
      },
      paths: { temp: 'C:\\t', userData: 'C:\\u', binaries: 'C:\\b' }
    }
    expect(() => registerMain(ctx)).not.toThrow()
    expect(tasks.has('start')).toBe(true)
    expect(tasks.has('cookie:import-browser')).toBe(true)
    expect(ipc.has('probe')).toBe(true)
    expect(ipc.has('cookie:list')).toBe(true)
  })
})
