/**
 * @file node.test.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description 打印主进程逻辑单测（vi.mock electron + 假 ctx/假窗口，不触达真实打印机）。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runProcess, SpawnError, type RunProcessResult } from '@lumin/node-kit'
import type { IpcHandler, MainPluginContext, TaskHandler } from '@lumin/plugin-api'
import type { TaskUpdate } from '@lumin/shared'
import { manifest } from '../manifest'
import {
  cleanupStaleJobs,
  createBrowserPrintWindow,
  createNodeDeps,
  printBaseDir,
  registerMain,
  registerWith,
  toPrintUrl,
  type PrintDeps,
  type PrintWindow
} from './node'
import type { PrepareResult, StatusResult } from './schema'

/** electron 假件（BrowserWindow 构造与打印回调行为可控） */
const electronMock = vi.hoisted(() => {
  type PrintCallback = (success: boolean, reason?: string) => void
  const state = {
    instances: [] as FakeWindow[],
    loadUrls: [] as string[],
    loadError: null as string | null,
    printSuccess: true,
    printReason: undefined as string | undefined,
    manualPrint: false,
    manualCallback: null as PrintCallback | null,
    printOptions: [] as unknown[],
    pdfOptions: [] as unknown[],
    revealed: 0,
    destroyed: 0
  }

  class FakeWindow {
    options: Record<string, unknown>
    openHandler: (() => { action: 'deny' }) | null = null
    navHandler: ((event: { preventDefault: () => void }) => void) | null = null
    webContents = {
      setWindowOpenHandler: (handler: () => { action: 'deny' }): void => {
        this.openHandler = handler
      },
      on: (event: string, listener: (event: { preventDefault: () => void }) => void): void => {
        if (event === 'will-navigate') this.navHandler = listener
      },
      print: (options: unknown, callback: PrintCallback): void => {
        state.printOptions.push(options)
        if (state.manualPrint) {
          state.manualCallback = callback
          return
        }
        callback(state.printSuccess, state.printReason)
      },
      printToPDF: async (options: unknown): Promise<Buffer> => {
        state.pdfOptions.push(options)
        return Buffer.from('%PDF-1.7 fake')
      }
    }

    constructor(options: Record<string, unknown>) {
      this.options = options
      state.instances.push(this)
    }

    loadURL = async (url: string): Promise<void> => {
      state.loadUrls.push(url)
      if (state.loadError !== null) throw new Error(state.loadError)
    }

    showInactive = (): void => {
      state.revealed += 1
    }

    isDestroyed = (): boolean => false

    destroy = (): void => {
      state.destroyed += 1
    }
  }

  return { state, BrowserWindow: FakeWindow }
})

vi.mock('electron', () => ({ BrowserWindow: electronMock.BrowserWindow }))

vi.mock('@lumin/node-kit/pdf', () => ({
  openPdf: vi.fn(async () => ({
    pageCount: 2,
    doc: { cleanup: async () => undefined }
  })),
  renderPageToCanvas: vi.fn(async () => ({ canvas: { width: 100, height: 100 } })),
  encodeCanvas: vi.fn(async () => Buffer.from('png'))
}))

vi.mock('@lumin/node-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lumin/node-kit')>()
  return {
    ...actual,
    runProcess: vi.fn(async () => ({
      code: 0,
      signal: null,
      stdout: '    InstallPath    REG_SZ    C:\\LO\\program\\',
      stderr: '',
      timedOut: false,
      aborted: false,
      truncated: false
    }))
  }
})

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

interface Harness {
  ipc: Map<string, IpcHandler<unknown, unknown>>
  tasks: Map<string, TaskHandler<unknown, unknown>>
  deps: PrintDeps
  ctx: MainPluginContext
  root: string
  userData: string
  sofficeFile: string
  settings: Map<string, unknown>
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  electronMock.state.instances.length = 0
  electronMock.state.loadUrls.length = 0
  electronMock.state.loadError = null
  electronMock.state.printSuccess = true
  electronMock.state.printReason = undefined
  electronMock.state.manualPrint = false
  electronMock.state.manualCallback = null
  electronMock.state.printOptions.length = 0
  electronMock.state.pdfOptions.length = 0
  electronMock.state.revealed = 0
  electronMock.state.destroyed = 0
})

/** 构造假 ctx + 默认 deps（真实临时目录，PDF/打印能力可覆盖） */
function createHarness(
  overrides: Partial<PrintDeps> = {},
  initialSettings: Record<string, unknown> = {}
): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-print-test-'))
  roots.push(root)
  const userData = join(root, 'userData')
  mkdirSync(userData, { recursive: true })
  const regDir = join(root, 'reg', 'program')
  mkdirSync(regDir, { recursive: true })
  const sofficeFile = join(regDir, 'soffice.com')
  writeFileSync(sofficeFile, 'stub')

  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>(Object.entries(initialSettings))
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
    paths: { temp: join(root, 'temp'), userData, binaries: join(root, 'binaries') }
  }

  let seq = 0
  const base = createNodeDeps()
  const deps: PrintDeps = {
    ...base,
    // 去掉真实 fs 依赖中不需要的行为，避免测试触碰真实注册表/打印机
    queryRegistry: async () => regDir,
    openPdf: async () => ({ pageCount: 3 }),
    move: {
      rename: async () => undefined,
      copyFile: async () => undefined,
      unlink: async () => undefined
    },
    jobId: () => `j-test000${seq++}`,
    ...overrides
  }
  registerWith(ctx, deps)
  return { ipc, tasks, deps, ctx, root, userData, sofficeFile, settings }
}

function mustGet<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key)
  if (value === undefined) throw new Error(`缺少 handler：${String(key)}`)
  return value
}

async function invokeIpc(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  const handler = mustGet(harness.ipc, action)
  return handler({ toolId: manifest.id, action, payload })
}

async function runTask(
  harness: Harness,
  action: string,
  payload: unknown,
  signal = new AbortController().signal
): Promise<{ result: unknown; updates: TaskUpdate[] }> {
  const handler = mustGet(harness.tasks, action)
  const updates: TaskUpdate[] = []
  const result = await handler({
    toolId: manifest.id,
    action,
    payload,
    taskId: 'task-test-1',
    signal,
    emit: (update: TaskUpdate) => {
      updates.push(update)
    }
  })
  return { result, updates }
}

/** 在临时目录写一个输入文件 */
function makeInput(harness: Harness, name: string): string {
  const dir = join(harness.root, 'inputs')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, 'x')
  return path
}

/** 准备一批（返回 prepare 结果） */
async function prepare(harness: Harness, paths: string[]): Promise<PrepareResult> {
  const { result } = await runTask(harness, 'prepare', { inputPaths: paths })
  return result as PrepareResult
}

describe('status', () => {
  it('customPath 可用时返回 available 并保存设置', async () => {
    const h = createHarness()
    const status = (await invokeIpc(h, 'status', { customPath: h.sofficeFile })) as StatusResult
    expect(status.soffice.available).toBe(true)
    expect(status.soffice.path).toBe(h.sofficeFile)
    expect(h.settings.get('customPath')).toBe(h.sofficeFile)
  })

  it('无自定义路径且注册表无结果时 unavailable', async () => {
    const h = createHarness({ queryRegistry: async () => null, fileExists: () => false })
    const status = (await invokeIpc(h, 'status', {})) as StatusResult
    expect(status.soffice.available).toBe(false)
    expect(status.soffice.customPath).toBe('')
  })
})

describe('prepare', () => {
  it('PDF 与图片各生成 job，并上报完成进度', async () => {
    const h = createHarness()
    const pdf = makeInput(h, '报告.pdf')
    const png = makeInput(h, '图 1.png')
    const { result, updates } = await runTask(h, 'prepare', { inputPaths: [pdf, png] })
    const prepared = result as PrepareResult
    expect(prepared.failures).toEqual([])
    expect(prepared.jobs.map((job) => job.kind)).toEqual(['pdf', 'image'])
    expect(prepared.jobs[0]?.pageCount).toBe(3)
    expect(prepared.jobs[0]?.name).toBe('报告.pdf')
    const htmlPath = join(printBaseDir(h.userData), prepared.jobs[1]?.jobId ?? '', 'print.html')
    expect(existsSync(htmlPath)).toBe(true)
    const last = updates.at(-1)
    expect(last?.kind).toBe('progress')
    if (last?.kind === 'progress') expect(last.stage).toBe('done')
  })

  it('相对路径与不支持格式分别记失败；全部失败时抛首个错误', async () => {
    const h = createHarness()
    const txt = makeInput(h, 'a.txt')
    const relative = await runTask(h, 'prepare', { inputPaths: ['a.pdf'] }).catch((err) => err)
    expect(relative).toMatchObject({ code: 'PR_INVALID_PATH' })

    await expect(runTask(h, 'prepare', { inputPaths: [txt] })).rejects.toMatchObject({
      code: 'PR_UNSUPPORTED_FORMAT'
    })
  })

  it('混合批次：失败项不阻断其余文件', async () => {
    const h = createHarness()
    const pdf = makeInput(h, 'ok.pdf')
    const txt = makeInput(h, 'bad.txt')
    const prepared = await prepare(h, [pdf, txt])
    expect(prepared.jobs).toHaveLength(1)
    expect(prepared.failures).toHaveLength(1)
    expect(prepared.failures[0]?.code).toBe('PR_UNSUPPORTED_FORMAT')
  })

  it('超过 50 份直接拒绝', async () => {
    const h = createHarness()
    const paths = Array.from({ length: 51 }, (_, index) => `C:\\f\\${String(index)}.pdf`)
    await expect(runTask(h, 'prepare', { inputPaths: paths })).rejects.toMatchObject({
      code: 'PR_TOO_MANY_FILES'
    })
  })

  it('Office 走 soffice 转换并校验产物页数', async () => {
    const h = createHarness({
      openPdf: async () => ({ pageCount: 4 }),
      run: async () => okResult(),
      readHead: async () => '%PDF-1.7'
    })
    h.settings.set('customPath', h.sofficeFile)
    const docx = makeInput(h, '文档.docx')
    const prepared = await prepare(h, [docx])
    expect(prepared.jobs[0]?.kind).toBe('office')
    expect(prepared.jobs[0]?.pageCount).toBe(4)
    expect(prepared.jobs[0]?.sourcePath).toContain('print.pdf')
  })

  it('缺少 soffice 时 Office 批次报 PR_SOFFICE_MISSING', async () => {
    const h = createHarness({ queryRegistry: async () => null, fileExists: () => false })
    const docx = makeInput(h, '文档.docx')
    await expect(runTask(h, 'prepare', { inputPaths: [docx] })).rejects.toMatchObject({
      code: 'PR_SOFFICE_MISSING'
    })
  })

  it('转换失败记录 PR_CONVERT_FAILED', async () => {
    const h = createHarness({
      run: async () => okResult({ code: 1, stderr: 'boom' })
    })
    h.settings.set('customPath', h.sofficeFile)
    const docx = makeInput(h, '文档.docx')
    await expect(runTask(h, 'prepare', { inputPaths: [docx] })).rejects.toMatchObject({
      code: 'PR_CONVERT_FAILED'
    })
  })

  it('占用/缺失/超大/读取失败分别映射错误码', async () => {
    const locked = createHarness({
      checkExclusive: async () => {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      }
    })
    await expect(
      runTask(locked, 'prepare', { inputPaths: [makeInput(locked, 'a.pdf')] })
    ).rejects.toMatchObject({ code: 'PR_LOCKED' })

    const missing = createHarness({
      checkReadable: async () => {
        throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      }
    })
    await expect(
      runTask(missing, 'prepare', { inputPaths: [makeInput(missing, 'a.pdf')] })
    ).rejects.toMatchObject({ code: 'PR_NOT_FOUND' })

    const tooLarge = createHarness({ statSize: async () => 500 * 1024 * 1024 + 1 })
    await expect(
      runTask(tooLarge, 'prepare', { inputPaths: [makeInput(tooLarge, 'a.pdf')] })
    ).rejects.toMatchObject({ code: 'PR_TOO_LARGE' })

    const statFails = createHarness({
      statSize: async () => {
        throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      }
    })
    await expect(
      runTask(statFails, 'prepare', { inputPaths: [makeInput(statFails, 'a.pdf')] })
    ).rejects.toMatchObject({ code: 'PR_NOT_FOUND' })
  })

  it('转换失败且临目录清理失败时仍上报原错误', async () => {
    const h = createHarness({
      run: async () => okResult({ code: 1, stderr: 'boom' }),
      removeDir: async () => {
        throw new Error('locked dir')
      }
    })
    h.settings.set('customPath', h.sofficeFile)
    const docx = makeInput(h, '文档.docx')
    await expect(runTask(h, 'prepare', { inputPaths: [docx] })).rejects.toMatchObject({
      code: 'PR_CONVERT_FAILED'
    })
  })

  it('PDF 打开失败（非加密）报 PR_PDF_BROKEN', async () => {
    const h = createHarness({
      openPdf: async () => {
        throw new Error('invalid pdf')
      }
    })
    const pdf = makeInput(h, 'broken.pdf')
    await expect(runTask(h, 'prepare', { inputPaths: [pdf] })).rejects.toMatchObject({
      code: 'PR_PDF_BROKEN'
    })
  })

  it('转换进程启动失败报 PR_CONVERT_FAILED', async () => {
    const h = createHarness({
      run: async () => {
        throw new SpawnError('spawn failed', 'soffice.com')
      }
    })
    h.settings.set('customPath', h.sofficeFile)
    const docx = makeInput(h, '文档.docx')
    await expect(runTask(h, 'prepare', { inputPaths: [docx] })).rejects.toMatchObject({
      code: 'PR_CONVERT_FAILED',
      detail: 'soffice.com'
    })
  })

  it('转换抛出未知错误报 PR_CONVERT_FAILED', async () => {
    const h = createHarness({
      run: async () => {
        throw new Error('boom')
      }
    })
    h.settings.set('customPath', h.sofficeFile)
    const docx = makeInput(h, '文档.docx')
    await expect(runTask(h, 'prepare', { inputPaths: [docx] })).rejects.toMatchObject({
      code: 'PR_CONVERT_FAILED'
    })
  })

  it('转换中收到取消信号时终止并上报取消', async () => {
    const h = createHarness()
    const controller = new AbortController()
    h.deps.run = async () => {
      controller.abort()
      throw new Error('aborted')
    }
    h.settings.set('customPath', h.sofficeFile)
    const docx = makeInput(h, '文档.docx')
    await expect(runTask(h, 'prepare', { inputPaths: [docx] }, controller.signal)).rejects.toThrow(
      'aborted'
    )
  })

  it('转换产物校验不通过报 PR_CONVERT_FAILED', async () => {
    const h = createHarness({
      run: async () => okResult(),
      readHead: async () => 'not-a-pdf'
    })
    h.settings.set('customPath', h.sofficeFile)
    const docx = makeInput(h, '空产物.docx')
    await expect(runTask(h, 'prepare', { inputPaths: [docx] })).rejects.toMatchObject({
      code: 'PR_CONVERT_FAILED'
    })
  })
})

describe('show', () => {
  it('加载 PDF、显示窗口并弹出系统对话框', async () => {
    const h = createHarness()
    const pdf = makeInput(h, 'a.pdf')
    const prepared = await prepare(h, [pdf])
    const jobId = prepared.jobs[0]?.jobId ?? ''
    const { result } = await runTask(h, 'show', { jobId })
    expect(result).toMatchObject({ jobId, name: 'a.pdf', pageCount: 3 })
    expect(electronMock.state.revealed).toBe(1)
    expect(electronMock.state.printOptions[0]).toEqual({ silent: false })
    expect(electronMock.state.loadUrls[0]?.startsWith('file:///')).toBe(true)
    expect(electronMock.state.destroyed).toBeGreaterThan(0)
  })

  it('对话框取消映射为 PR_PRINT_CANCELLED', async () => {
    const h = createHarness()
    const pdf = makeInput(h, 'a.pdf')
    const prepared = await prepare(h, [pdf])
    electronMock.state.printSuccess = false
    electronMock.state.printReason = 'Print job canceled'
    await expect(
      runTask(h, 'show', { jobId: prepared.jobs[0]?.jobId ?? '' })
    ).rejects.toMatchObject({ code: 'PR_PRINT_CANCELLED' })
  })

  it('其他失败原因映射为 PR_PRINT_FAILED', async () => {
    const h = createHarness()
    const pdf = makeInput(h, 'a.pdf')
    const prepared = await prepare(h, [pdf])
    electronMock.state.printSuccess = false
    electronMock.state.printReason = 'printer offline'
    await expect(
      runTask(h, 'show', { jobId: prepared.jobs[0]?.jobId ?? '' })
    ).rejects.toMatchObject({ code: 'PR_PRINT_FAILED', detail: 'printer offline' })
  })

  it('同一时刻只允许一份，并发报 PR_PRINT_BUSY', async () => {
    const h = createHarness()
    const pdf = makeInput(h, 'a.pdf')
    const prepared = await prepare(h, [pdf])
    const jobId = prepared.jobs[0]?.jobId ?? ''
    electronMock.state.manualPrint = true
    const first = runTask(h, 'show', { jobId })
    await vi.waitFor(() => {
      expect(electronMock.state.manualCallback).not.toBeNull()
    })
    await expect(runTask(h, 'show', { jobId })).rejects.toMatchObject({ code: 'PR_PRINT_BUSY' })
    electronMock.state.manualCallback?.(true)
    await expect(first).resolves.toBeTruthy()
  })

  it('取消信号中止等待并关闭窗口', async () => {
    const h = createHarness()
    const pdf = makeInput(h, 'a.pdf')
    const prepared = await prepare(h, [pdf])
    electronMock.state.manualPrint = true
    const controller = new AbortController()
    const task = runTask(h, 'show', { jobId: prepared.jobs[0]?.jobId ?? '' }, controller.signal)
    await vi.waitFor(() => {
      expect(electronMock.state.manualCallback).not.toBeNull()
    })
    controller.abort()
    await expect(task).rejects.toMatchObject({ code: 'PR_PRINT_CANCELLED' })
    expect(electronMock.state.destroyed).toBeGreaterThan(0)
  })

  it('未知 jobId 报 PR_NOT_FOUND', async () => {
    const h = createHarness()
    await expect(runTask(h, 'show', { jobId: 'j-unknown01' })).rejects.toMatchObject({
      code: 'PR_NOT_FOUND'
    })
  })

  it('PDFium 装载失败时栅格兜底一次', async () => {
    const h = createHarness({
      rasterizeToHtml: async (_source, outDir) => {
        electronMock.state.loadError = null
        const html = join(outDir, 'fallback.html')
        writeFileSync(html, '<html></html>')
        return html
      }
    })
    const pdf = makeInput(h, 'a.pdf')
    const prepared = await prepare(h, [pdf])
    electronMock.state.loadError = 'ERR_FAILED'
    const { result } = await runTask(h, 'show', { jobId: prepared.jobs[0]?.jobId ?? '' })
    expect(result).toMatchObject({ name: 'a.pdf' })
    expect(electronMock.state.loadUrls.at(-1)).toContain('fallback.html')
  })

  it('dryRun 产出 PDF 文件而不弹系统对话框', async () => {
    const h = createHarness({ dryRun: true })
    const png = makeInput(h, 'a.png')
    const prepared = await prepare(h, [png])
    const jobId = prepared.jobs[0]?.jobId ?? ''
    await runTask(h, 'show', { jobId })
    expect(existsSync(join(printBaseDir(h.userData), jobId, 'dry-run.pdf'))).toBe(true)
    expect(electronMock.state.pdfOptions).toHaveLength(1)
    expect(electronMock.state.printOptions).toHaveLength(0)
  })

  it('PDF 栅格兜底后仍装载失败 → PR_PDF_BROKEN', async () => {
    const h = createHarness({
      rasterizeToHtml: async (_source, outDir) => {
        const html = join(outDir, 'fallback.html')
        writeFileSync(html, '<html></html>')
        return html
      }
    })
    const pdf = makeInput(h, 'a.pdf')
    const prepared = await prepare(h, [pdf])
    electronMock.state.loadError = 'ERR_FAILED'
    await expect(
      runTask(h, 'show', { jobId: prepared.jobs[0]?.jobId ?? '' })
    ).rejects.toMatchObject({ code: 'PR_PDF_BROKEN' })
  })

  it('销毁窗口抛错不影响主流程', async () => {
    const h = createHarness({
      createPrintWindow: () => ({
        load: async () => undefined,
        reveal: () => undefined,
        print: async () => ({ success: true }),
        destroy: () => {
          throw new Error('already gone')
        }
      })
    })
    const pdf = makeInput(h, 'a.pdf')
    const prepared = await prepare(h, [pdf])
    await expect(runTask(h, 'show', { jobId: prepared.jobs[0]?.jobId ?? '' })).resolves.toBeTruthy()
  })

  it('非 PDF 装载失败 → PR_PRINT_FAILED', async () => {
    const h = createHarness()
    const png = makeInput(h, 'a.png')
    const prepared = await prepare(h, [png])
    electronMock.state.loadError = 'ERR_FAILED'
    await expect(
      runTask(h, 'show', { jobId: prepared.jobs[0]?.jobId ?? '' })
    ).rejects.toMatchObject({ code: 'PR_PRINT_FAILED' })
  })
})

describe('cleanup', () => {
  it('按 jobId 清理产物并返回数量', async () => {
    const h = createHarness()
    const first = makeInput(h, 'a.pdf')
    const second = makeInput(h, 'b.png')
    const prepared = await prepare(h, [first, second])
    const kept = prepared.jobs[1]?.jobId ?? ''
    const removed = (await invokeIpc(h, 'cleanup', {
      jobIds: [prepared.jobs[0]?.jobId ?? '']
    })) as { removed: number }
    expect(removed.removed).toBe(1)
    expect(existsSync(join(printBaseDir(h.userData), prepared.jobs[0]?.jobId ?? ''))).toBe(false)
    expect(existsSync(join(printBaseDir(h.userData), kept))).toBe(true)
    const rest = (await invokeIpc(h, 'cleanup', {})) as { removed: number }
    expect(rest.removed).toBe(1)
  })

  it('清理超过 24h 的残留目录', async () => {
    const h = createHarness()
    const base = printBaseDir(h.userData)
    const stale = join(base, 'j-stale0001')
    const fresh = join(base, 'j-fresh0001')
    mkdirSync(stale, { recursive: true })
    mkdirSync(fresh, { recursive: true })
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    utimesSync(stale, old, old)
    const removed = await cleanupStaleJobs(base, h.deps)
    expect(removed).toBe(1)
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })
})

describe('createBrowserPrintWindow', () => {
  it('沿用安全基线并支持 dry-run 落盘', async () => {
    const win: PrintWindow = createBrowserPrintWindow()
    const created = electronMock.state.instances.at(-1)
    expect(created?.options).toMatchObject({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        plugins: true
      }
    })
    expect(created?.openHandler?.()).toEqual({ action: 'deny' })
    const event = { preventDefault: vi.fn() }
    created?.navHandler?.(event)
    expect(event.preventDefault).toHaveBeenCalled()
    await win.load('file:///C:/a.pdf')
    win.reveal()
    const dir = mkdtempSync(join(tmpdir(), 'lumin-print-dry-'))
    roots.push(dir)
    const target = join(dir, 'dry-run.pdf')
    await expect(win.print(target)).resolves.toEqual({ success: true })
    expect(existsSync(target)).toBe(true)
    win.destroy()
  })
})

describe('prepare 取消与入参边界', () => {
  it('已取消的信号不再继续准备', async () => {
    const h = createHarness()
    const pdf = makeInput(h, 'a.pdf')
    const controller = new AbortController()
    controller.abort()
    await expect(runTask(h, 'prepare', { inputPaths: [pdf] }, controller.signal)).rejects.toThrow(
      'aborted'
    )
  })

  it('status 入参非法时忽略保存仍返回状态', async () => {
    const h = createHarness()
    const status = (await invokeIpc(h, 'status', { customPath: 123 })) as StatusResult
    expect(status.soffice.available).toBeTypeOf('boolean')
    expect(h.settings.has('customPath')).toBe(false)
  })

  it('残留目录不存在时清理返回 0', async () => {
    const h = createHarness()
    await expect(cleanupStaleJobs(join(h.root, 'missing'), h.deps)).resolves.toBe(0)
  })
})

describe('createNodeDeps 真实实现', () => {
  it('queryRegistry 解析路径 / 非 0 / 抛错', async () => {
    const deps = createNodeDeps()
    await expect(deps.queryRegistry('HKLM\\SOFTWARE\\LibreOffice')).resolves.toBe(
      'C:\\LO\\program\\'
    )
    // 真实注册表输出：值名为 (Default) / 带版本号，且先出现键名标题行
    vi.mocked(runProcess).mockResolvedValueOnce(
      okResult({
        stdout:
          'HKEY_LOCAL_MACHINE\\SOFTWARE\\LibreOffice\\UNO\\InstallPath\r\n' +
          '    (Default)    REG_SZ    D:\\software\\LibreOffice\\program\r\n' +
          '    LibreOffice 26.8    REG_SZ    D:\\software\\LibreOffice\\program\r\n'
      })
    )
    await expect(deps.queryRegistry('x')).resolves.toBe('D:\\software\\LibreOffice\\program')
    vi.mocked(runProcess).mockResolvedValueOnce(okResult({ code: 1 }))
    await expect(deps.queryRegistry('x')).resolves.toBeNull()
    vi.mocked(runProcess).mockRejectedValueOnce(new Error('boom'))
    await expect(deps.queryRegistry('x')).resolves.toBeNull()
  })

  it('rasterizeToHtml 逐页落盘并生成分页 HTML', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumin-print-raster-'))
    roots.push(dir)
    const html = await createNodeDeps().rasterizeToHtml('C:\\a 文档.pdf', dir)
    expect(existsSync(join(dir, 'page-001.png'))).toBe(true)
    expect(existsSync(join(dir, 'page-002.png'))).toBe(true)
    expect(readFileSync(html, 'utf8')).toContain('page-002.png')
  })

  it('openPdf 读取页数并释放文档 / jobId 合法 / 注册入口可用', async () => {
    const deps = createNodeDeps()
    await expect(deps.openPdf('C:\\a.pdf')).resolves.toEqual({ pageCount: 2 })
    expect(deps.jobId()).toMatch(/^j-[a-z0-9]+-[a-z0-9]+$/)
    const h = createHarness()
    await expect(registerMain(h.ctx)).resolves.toBeUndefined()
    expect(h.ipc.has('status')).toBe(true)
    expect(h.tasks.has('show')).toBe(true)
  })

  it('queryRegistry 无匹配行时返回 null', async () => {
    vi.mocked(runProcess).mockResolvedValueOnce(okResult({ stdout: 'nothing here' }))
    await expect(createNodeDeps().queryRegistry('x')).resolves.toBeNull()
  })

  it('文件写入/探测/移动/清理可用', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumin-print-fs-'))
    roots.push(dir)
    const deps = createNodeDeps()
    const target = join(dir, 'nested', 'a.txt')
    await deps.makeDir(join(dir, 'nested'))
    await deps.writeText(target, 'hello')
    await expect(deps.readHead(target)).resolves.toContain('hello')
    await deps.move.rename(target, join(dir, 'b.txt'))
    expect(existsSync(target)).toBe(false)
    await deps.move.copyFile(join(dir, 'b.txt'), join(dir, 'c.txt'))
    await deps.move.unlink(join(dir, 'c.txt'))
    expect(existsSync(join(dir, 'c.txt'))).toBe(false)
    const entries = await deps.listDir(dir)
    expect(entries.map((entry) => entry.name)).toContain('b.txt')
    await deps.removeDir(join(dir, 'nested'))
    expect(existsSync(join(dir, 'nested'))).toBe(false)
  })

  it('打印窗口真实路径调用 silent:false 回调', async () => {
    const win = createBrowserPrintWindow()
    await win.load('file:///C:/a.pdf')
    await expect(win.print(null)).resolves.toEqual({ success: true })
    expect(electronMock.state.printOptions[0]).toEqual({ silent: false })
    win.destroy()
  })
})

describe('toPrintUrl / createNodeDeps', () => {
  it('中文与空格路径安全编码', () => {
    expect(toPrintUrl('C:\\临时 目录\\a b.pdf')).toMatch(/^file:\/\/\/C:\/%E4%B8%B4/)
  })

  it('文件存在/体积/读写探测可用', async () => {
    const h = createHarness()
    const input = makeInput(h, 'probe.png')
    const deps = createNodeDeps()
    expect(deps.fileExists(input)).toBe(true)
    expect(deps.fileExists(join(h.root, 'nope'))).toBe(false)
    await expect(deps.statSize(input)).resolves.toBe(1)
    await expect(deps.checkReadable(input)).resolves.toBeUndefined()
    await expect(deps.checkExclusive(input)).resolves.toBeUndefined()
    await expect(deps.readHead(input)).resolves.toContain('x')
    expect(statSync(input).size).toBe(1)
    expect(readdirSync(join(h.root, 'inputs'))).toContain('probe.png')
  })
})
