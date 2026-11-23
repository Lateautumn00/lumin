import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SpawnError, type RunProcessOptions, type RunProcessResult } from '@lumin/node-kit'
import type { IpcHandler, MainPluginContext, TaskHandler } from '@lumin/plugin-api'
import type { TaskUpdate } from '@lumin/shared'
import type { DownloadOptions } from './download'
import { toolError } from './errors'
import { manifest } from './manifest'
import { createNodeDeps, registerWith, type Docx2pdfDeps } from './node'

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
  deps: Docx2pdfDeps
  root: string
  tempRoot: string
  userDataRoot: string
  settings: Map<string, unknown>
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function createHarness(
  overrides: Partial<Docx2pdfDeps> = {},
  initialSettings: Record<string, unknown> = {}
): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-d2p-test-'))
  roots.push(root)
  const tempRoot = join(root, 'temp')
  const userDataRoot = join(root, 'userData')
  mkdirSync(tempRoot, { recursive: true })
  mkdirSync(userDataRoot, { recursive: true })

  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>(Object.entries(initialSettings))
  // 默认注入注册表 mock（存在 soffice.com），需要「无组件」语义的用例自行覆盖
  const regProgramDir = join(root, 'reg', 'program')
  mkdirSync(regProgramDir, { recursive: true })
  writeFileSync(join(regProgramDir, 'soffice.com'), 'stub')
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
    paths: { temp: tempRoot, userData: userDataRoot, binaries: join(root, 'binaries') }
  }
  const deps: Docx2pdfDeps = {
    ...createNodeDeps(),
    queryRegistry: async () => regProgramDir,
    ...overrides
  }
  registerWith(ctx, deps)
  return { ipc, tasks, deps, root, tempRoot, userDataRoot, settings }
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

interface RunTaskOptions {
  taskId?: string
  signal?: AbortSignal
  updates?: TaskUpdate[]
}

async function runTask(
  harness: Harness,
  action: string,
  payload: unknown,
  options: RunTaskOptions = {}
): Promise<unknown> {
  const handler = mustGet(harness.tasks, action)
  return handler({
    toolId: manifest.id,
    action,
    payload,
    taskId: options.taskId ?? 'task-1',
    signal: options.signal ?? new AbortController().signal,
    emit: (update) => options.updates?.push(update)
  })
}

/** 造一个可转换的输入文件，返回路径 */
function makeInput(harness: Harness, name = '报告.docx'): string {
  const dir = join(harness.root, 'in')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, 'PK\x03\x04fake-docx')
  return path
}

/** 假 soffice 转换：往 --outdir 写出同基名 PDF */
function fakeConvertRun(
  content = '%PDF-1.7\nlumin'
): (options: RunProcessOptions) => Promise<RunProcessResult> {
  return async (options) => {
    const args = options.args ?? []
    const outIndex = args.indexOf('--outdir')
    const outDir = outIndex >= 0 ? args[outIndex + 1] : undefined
    const input = args.at(-1)
    if (outDir === undefined || input === undefined) throw new Error('参数不完整')
    const base = basename(input, extname(input))
    writeFileSync(join(outDir, `${base}.pdf`), content)
    return okResult()
  }
}

function makePortableSoffice(harness: Harness): string {
  const programDir = join(harness.userDataRoot, 'libreoffice-portable', 'program')
  mkdirSync(programDir, { recursive: true })
  const entry = join(programDir, 'soffice.com')
  writeFileSync(entry, 'stub')
  return entry
}

/** 假下载：落一个假 msi 并回报进度 */
function fakeDownload(options: DownloadOptions): Promise<string> {
  mkdirSync(options.destDir, { recursive: true })
  const msiPath = join(options.destDir, 'LibreOffice_26.8.3_Win_x86-64.msi')
  writeFileSync(msiPath, 'msi')
  options.onProgress?.(100, 100)
  return Promise.resolve(msiPath)
}

/** 假 msiexec：断言参数并可选造出便携入口 */
function fakeMsiexec(harness: Harness, sofficeCreated: boolean) {
  return async (options: RunProcessOptions): Promise<RunProcessResult> => {
    expect(options.command).toBe('msiexec')
    expect(options.args?.[0]).toBe('/a')
    expect(options.timeoutMs).toBe(600_000)
    if (sofficeCreated) makePortableSoffice(harness)
    return okResult()
  }
}

describe('docx2pdf registerMain', () => {
  it('注册 status/set-path 同步通道与 convert/install 任务', () => {
    const harness = createHarness()
    expect([...harness.ipc.keys()].sort()).toEqual(['set-path', 'status'])
    expect([...harness.tasks.keys()].sort()).toEqual(['convert', 'install'])
  })

  describe('status', () => {
    it('三级全无 → none', async () => {
      const harness = createHarness({ queryRegistry: async () => null })
      await expect(invokeIpc(harness, 'status', undefined)).resolves.toEqual({
        source: 'none',
        customInvalid: false,
        customPath: ''
      })
    })

    it('自定义路径有效 → custom（回填 customPath）', async () => {
      const harness = createHarness()
      const customPath = join(harness.root, 'lo-mock', 'soffice.com')
      mkdirSync(join(harness.root, 'lo-mock'), { recursive: true })
      writeFileSync(customPath, 'stub')
      harness.settings.set('customPath', customPath)
      await expect(invokeIpc(harness, 'status', undefined)).resolves.toMatchObject({
        source: 'custom',
        path: customPath,
        customInvalid: false,
        customPath
      })
    })

    it('自定义路径无效 + 注册表命中 → system 且 customInvalid=true', async () => {
      const harness = createHarness({}, { customPath: 'D:\\gone\\soffice.exe' })
      const programDir = join(harness.root, 'reg', 'program')
      mkdirSync(programDir, { recursive: true })
      writeFileSync(join(programDir, 'soffice.com'), 'stub')
      harness.deps.queryRegistry = async () => programDir
      await expect(invokeIpc(harness, 'status', undefined)).resolves.toMatchObject({
        source: 'system',
        customInvalid: true,
        customPath: 'D:\\gone\\soffice.exe'
      })
    })

    it('便携组件已安装 → portable', async () => {
      const harness = createHarness({ queryRegistry: async () => null })
      const entry = makePortableSoffice(harness)
      await expect(invokeIpc(harness, 'status', undefined)).resolves.toMatchObject({
        source: 'portable',
        path: entry
      })
    })
  })

  describe('set-path', () => {
    it('写入设置并返回最新 status', async () => {
      const harness = createHarness()
      const result = (await invokeIpc(harness, 'set-path', { path: 'C:\\lo\\soffice.exe' })) as {
        customPath: string
      }
      expect(result.customPath).toBe('C:\\lo\\soffice.exe')
      expect(harness.settings.get('customPath')).toBe('C:\\lo\\soffice.exe')
    })

    it('清空路径（空串）恢复三级定位', async () => {
      const harness = createHarness(
        { queryRegistry: async () => null },
        { customPath: 'C:\\lo\\soffice.exe' }
      )
      const result = (await invokeIpc(harness, 'set-path', { path: '' })) as { source: string }
      expect(result.source).toBe('none')
      expect(harness.settings.get('customPath')).toBe('')
    })

    it('payload 非法 → INVALID_PAYLOAD', async () => {
      const harness = createHarness()
      await expect(invokeIpc(harness, 'set-path', null)).rejects.toMatchObject({
        code: 'INVALID_PAYLOAD'
      })
    })
  })

  describe('convert', () => {
    it('happy path：转换、校验、落盘同基名 PDF，工作目录清理', async () => {
      const harness = createHarness({ run: fakeConvertRun() })
      const input = makeInput(harness)
      const updates: TaskUpdate[] = []
      const result = (await runTask(harness, 'convert', { inputPaths: [input] }, { updates })) as {
        outputs: { inputPath: string; outputPath: string }[]
        failures: unknown[]
      }
      expect(result.failures).toEqual([])
      expect(result.outputs[0]?.outputPath).toBe(join(harness.root, 'in', '报告.pdf'))
      expect(existsSync(result.outputs[0]?.outputPath ?? '')).toBe(true)
      expect(
        updates.map((update) => (update.kind === 'progress' ? update.stage : undefined))
      ).toEqual(['locate', 'convert', 'done'])
      expect(readdirSync(harness.tempRoot)).toEqual([])
    })

    it('输入不存在 → INPUT_NOT_FOUND', async () => {
      const harness = createHarness()
      await expect(
        runTask(harness, 'convert', { inputPaths: [join(harness.root, 'nope.docx')] })
      ).rejects.toMatchObject({ code: 'INPUT_NOT_FOUND' })
    })

    it('文件被占用 → INPUT_LOCKED', async () => {
      const harness = createHarness({
        checkExclusive: async () => {
          throw { code: 'EBUSY' }
        }
      })
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'INPUT_LOCKED'
      })
    })

    it('无可用组件 → SOFFICE_NOT_FOUND', async () => {
      const harness = createHarness({ queryRegistry: async () => null })
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'SOFFICE_NOT_FOUND'
      })
    })

    it('非法扩展名 → INVALID_PAYLOAD', async () => {
      const harness = createHarness()
      await expect(
        runTask(harness, 'convert', { inputPaths: [join(harness.root, 'a.txt')] })
      ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    })

    it('超时 → CONVERT_TIMEOUT', async () => {
      const harness = createHarness({
        run: async () => okResult({ timedOut: true, code: null })
      })
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'CONVERT_TIMEOUT'
      })
    })

    it('源文件无法加载 → INPUT_LOAD_FAILED', async () => {
      const harness = createHarness({
        run: async () => okResult({ code: 1, stderr: 'Error: source file could not be loaded!' })
      })
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'INPUT_LOAD_FAILED'
      })
    })

    it('其他非零退出 → CONVERT_FAILED 且 detail 透传 stderr', async () => {
      const harness = createHarness({
        run: async () => okResult({ code: 2, stderr: 'boom' })
      })
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'CONVERT_FAILED',
        detail: 'boom'
      })
    })

    it('假成功（无 PDF 产物）→ OUTPUT_MISSING 且工作目录清理', async () => {
      const harness = createHarness({ run: async () => okResult() })
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'OUTPUT_MISSING'
      })
      expect(readdirSync(harness.tempRoot)).toEqual([])
    })

    it('产物头非 %PDF- → OUTPUT_MISSING', async () => {
      const harness = createHarness({ run: fakeConvertRun('<html>fake</html>') })
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'OUTPUT_MISSING'
      })
    })

    it('同名输出占用 → 自动 (1) 后缀', async () => {
      const harness = createHarness({ run: fakeConvertRun() })
      const input = makeInput(harness)
      writeFileSync(join(harness.root, 'in', '报告.pdf'), 'existing')
      const result = (await runTask(harness, 'convert', { inputPaths: [input] })) as {
        outputs: { outputPath: string }[]
      }
      expect(result.outputs[0]?.outputPath).toBe(join(harness.root, 'in', '报告(1).pdf'))
    })

    it('spawn 失败 → SPAWN_FAILED', async () => {
      const harness = createHarness({
        run: async () => {
          throw new SpawnError('spawn ENOENT', 'C:\\lo\\soffice.com')
        }
      })
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'SPAWN_FAILED'
      })
    })

    it('产物落位失败（磁盘满/只读）→ OUTPUT_WRITE_FAILED，工作目录照常清理', async () => {
      const harness = createHarness({ run: fakeConvertRun() })
      harness.deps.move = {
        ...harness.deps.move,
        rename: async () => {
          throw { code: 'ENOSPC' }
        }
      }
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'OUTPUT_WRITE_FAILED',
        detail: 'ENOSPC'
      })
      expect(readdirSync(harness.tempRoot)).toEqual([])
    })

    it('临时目录创建失败 → OUTPUT_WRITE_FAILED', async () => {
      const harness = createHarness({
        run: fakeConvertRun(),
        makeDir: async () => {
          throw { code: 'EACCES' }
        }
      })
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'OUTPUT_WRITE_FAILED',
        detail: 'EACCES'
      })
    })

    it('临时目录创建抛结构化错误 → 原样上抛', async () => {
      const harness = createHarness({
        run: fakeConvertRun(),
        makeDir: async () => {
          throw toolError('OUTPUT_WRITE_FAILED')
        }
      })
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'OUTPUT_WRITE_FAILED'
      })
    })

    it('临时目录创建抛普通错误 → detail 回退 String(err)', async () => {
      const harness = createHarness({
        run: fakeConvertRun(),
        makeDir: async () => {
          throw new Error('boom')
        }
      })
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'OUTPUT_WRITE_FAILED',
        detail: 'Error: boom'
      })
    })

    it('产物落位抛结构化错误 → 原样上抛', async () => {
      const harness = createHarness({ run: fakeConvertRun() })
      harness.deps.move = {
        ...harness.deps.move,
        rename: async () => {
          throw toolError('OUTPUT_WRITE_FAILED')
        }
      }
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'OUTPUT_WRITE_FAILED'
      })
    })

    it('产物落位抛普通错误 → detail 回退 String(err)', async () => {
      const harness = createHarness({ run: fakeConvertRun() })
      harness.deps.move = {
        ...harness.deps.move,
        rename: async () => {
          throw new Error('boom')
        }
      }
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'OUTPUT_WRITE_FAILED',
        detail: 'Error: boom'
      })
    })

    it('run 抛普通错误 → 归一为 INTERNAL 且不吞消息', async () => {
      const harness = createHarness({
        run: async () => {
          throw new Error('boom')
        }
      })
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'INTERNAL',
        message: 'boom'
      })
    })

    it('run 回报 aborted → 任务中止', async () => {
      const harness = createHarness({ run: async () => okResult({ aborted: true }) })
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toThrow('aborted')
    })

    it('makeDir 期间信号中止 → 任务中止（run 前守卫）', async () => {
      const controller = new AbortController()
      const harness = createHarness({
        run: fakeConvertRun(),
        makeDir: async () => {
          controller.abort()
        }
      })
      const input = makeInput(harness)
      await expect(
        runTask(harness, 'convert', { inputPaths: [input] }, { signal: controller.signal })
      ).rejects.toThrow('aborted')
    })

    it('转换期间信号中止 → 任务中止且不记为批次失败', async () => {
      const controller = new AbortController()
      const harness = createHarness({
        run: async () => {
          controller.abort()
          throw new Error('aborted')
        }
      })
      const input = makeInput(harness)
      await expect(
        runTask(harness, 'convert', { inputPaths: [input] }, { signal: controller.signal })
      ).rejects.toThrow('aborted')
    })

    it('同名输出 99 个后缀全占用 → OUTPUT_MISSING', async () => {
      const harness = createHarness({ fileExists: () => true })
      const input = makeInput(harness)
      await expect(runTask(harness, 'convert', { inputPaths: [input] })).rejects.toMatchObject({
        code: 'OUTPUT_MISSING'
      })
    })

    it('工作目录清理失败仅记日志，不吞结果（spec §7.4）', async () => {
      const harness = createHarness({
        run: fakeConvertRun(),
        removeDir: async () => {
          throw new Error('rm failed')
        }
      })
      const input = makeInput(harness)
      const result = (await runTask(harness, 'convert', { inputPaths: [input] })) as {
        outputs: { outputPath: string }[]
      }
      expect(result.outputs[0]?.outputPath.endsWith('报告.pdf')).toBe(true)
    })

    it('并发提交串行执行（convert 互斥）', async () => {
      let active = 0
      let maxActive = 0
      const slowRun = async (options: RunProcessOptions): Promise<RunProcessResult> => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 40))
        active -= 1
        return fakeConvertRun()(options)
      }
      const harness = createHarness({ run: slowRun })
      const inputA = makeInput(harness, 'a.docx')
      const inputB = makeInput(harness, 'b.docx')
      const [first, second] = await Promise.all([
        runTask(harness, 'convert', { inputPaths: [inputA] }, { taskId: 't-a' }),
        runTask(harness, 'convert', { inputPaths: [inputB] }, { taskId: 't-b' })
      ])
      expect(maxActive).toBe(1)
      expect(first).toEqual({
        outputs: [{ inputPath: inputA, outputPath: join(harness.root, 'in', 'a.pdf') }],
        failures: []
      })
      expect(second).toEqual({
        outputs: [{ inputPath: inputB, outputPath: join(harness.root, 'in', 'b.pdf') }],
        failures: []
      })
    })

    it('批量：多格式逐条转换，结果按提交顺序返回且进度带 total', async () => {
      const harness = createHarness({ run: fakeConvertRun() })
      const a = makeInput(harness, '甲.docx')
      const b = makeInput(harness, '乙.xlsx')
      const c = makeInput(harness, '丙.pptx')
      const updates: TaskUpdate[] = []
      const result = (await runTask(
        harness,
        'convert',
        { inputPaths: [a, b, c] },
        { updates }
      )) as {
        outputs: { inputPath: string; outputPath: string }[]
        failures: unknown[]
      }
      expect(result.failures).toEqual([])
      expect(result.outputs.map((item) => item.outputPath)).toEqual([
        join(harness.root, 'in', '甲.pdf'),
        join(harness.root, 'in', '乙.pdf'),
        join(harness.root, 'in', '丙.pdf')
      ])
      expect(updates.map((u) => (u.kind === 'progress' ? u.current : -1))).toEqual([0, 1, 2, 3, 3])
      expect(updates.map((u) => (u.kind === 'progress' ? u.total : -1))).toEqual([3, 3, 3, 3, 3])
      expect(readdirSync(harness.tempRoot)).toEqual([])
    })

    it('批量部分失败：单文件失败不中断，失败项随结果上报', async () => {
      const harness = createHarness({ run: fakeConvertRun() })
      const ok1 = makeInput(harness, 'ok1.docx')
      const missing = join(harness.root, 'in', '不存在.xlsx')
      const ok2 = makeInput(harness, 'ok2.pptx')
      const result = (await runTask(harness, 'convert', { inputPaths: [ok1, missing, ok2] })) as {
        outputs: { outputPath: string }[]
        failures: { inputPath: string; code: string; message: string }[]
      }
      expect(result.outputs.map((item) => item.outputPath)).toEqual([
        join(harness.root, 'in', 'ok1.pdf'),
        join(harness.root, 'in', 'ok2.pdf')
      ])
      expect(result.failures).toMatchObject([
        {
          inputPath: missing,
          code: 'INPUT_NOT_FOUND',
          message: '输入文件不存在，请重新选择'
        }
      ])
    })

    it('批量全部失败：抛首个结构化错误（保持单文件重试语义）', async () => {
      const harness = createHarness({ run: fakeConvertRun() })
      const missingA = join(harness.root, 'in', '缺甲.docx')
      const missingB = join(harness.root, 'in', '缺乙.xlsx')
      await expect(
        runTask(harness, 'convert', { inputPaths: [missingA, missingB] })
      ).rejects.toMatchObject({ code: 'INPUT_NOT_FOUND' })
    })

    it('重复路径（大小写不敏感）只转换一次', async () => {
      const harness = createHarness({ run: fakeConvertRun() })
      const input = makeInput(harness, '重复.docx')
      const duplicated = input.replace('重复.docx', '重复.DOCX')
      const updates: TaskUpdate[] = []
      const result = (await runTask(
        harness,
        'convert',
        { inputPaths: [input, duplicated] },
        { updates }
      )) as { outputs: unknown[] }
      expect(result.outputs).toHaveLength(1)
      const convertUpdates = updates.filter(
        (update) => update.kind === 'progress' && update.stage === 'convert'
      )
      expect(convertUpdates).toHaveLength(1)
    })

    it('批量同名基名（不同扩展名）→ 第二个自动 (1) 后缀', async () => {
      const harness = createHarness({ run: fakeConvertRun() })
      const a = makeInput(harness, '同名.docx')
      const b = makeInput(harness, '同名.xlsx')
      const result = (await runTask(harness, 'convert', { inputPaths: [a, b] })) as {
        outputs: { outputPath: string }[]
      }
      expect(result.outputs.map((item) => item.outputPath)).toEqual([
        join(harness.root, 'in', '同名.pdf'),
        join(harness.root, 'in', '同名(1).pdf')
      ])
    })

    it('空数组 / 超过 100 个 → INVALID_PAYLOAD', async () => {
      const harness = createHarness()
      await expect(runTask(harness, 'convert', { inputPaths: [] })).rejects.toMatchObject({
        code: 'INVALID_PAYLOAD'
      })
      const tooMany = Array.from({ length: 101 }, (_unused, index) => `C:\\x\\f${index}.docx`)
      await expect(runTask(harness, 'convert', { inputPaths: tooMany })).rejects.toMatchObject({
        code: 'INVALID_PAYLOAD'
      })
    })

    it('取消：信号中止 → 拒绝且工作目录清理', async () => {
      const controller = new AbortController()
      const harness = createHarness({
        run: async (options) =>
          new Promise<RunProcessResult>((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true
            })
          })
      })
      const input = makeInput(harness)
      const promise = runTask(
        harness,
        'convert',
        { inputPaths: [input] },
        { signal: controller.signal }
      )
      controller.abort()
      await expect(promise).rejects.toThrow('aborted')
      expect(readdirSync(harness.tempRoot)).toEqual([])
    })

    it('等锁期间取消：排队任务立即拒绝', async () => {
      const controller = new AbortController()
      let releaseFirst: (() => void) | undefined
      const gate = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      const harness = createHarness({
        run: async (options) => {
          await gate
          return fakeConvertRun()(options)
        }
      })
      const inputA = makeInput(harness, 'a.docx')
      const inputB = makeInput(harness, 'b.docx')
      const first = runTask(harness, 'convert', { inputPaths: [inputA] }, { taskId: 't-1' })
      const second = runTask(
        harness,
        'convert',
        { inputPaths: [inputB] },
        { taskId: 't-2', signal: controller.signal }
      )
      await new Promise((resolve) => setTimeout(resolve, 10))
      controller.abort()
      await expect(second).rejects.toThrow('aborted')
      releaseFirst?.()
      await first
    })
  })

  describe('install', () => {
    it('happy path：下载 → msiexec 静默解包 → 返回入口', async () => {
      const harness = createHarness()
      harness.deps.download = fakeDownload
      harness.deps.run = fakeMsiexec(harness, true)
      const updates: TaskUpdate[] = []
      const result = (await runTask(harness, 'install', {}, { updates })) as { path: string }
      expect(result.path).toBe(
        join(harness.userDataRoot, 'libreoffice-portable', 'program', 'soffice.com')
      )
      expect(updates.some((u) => u.kind === 'progress' && u.stage === 'download')).toBe(true)
      expect(updates.some((u) => u.kind === 'progress' && u.stage === 'install')).toBe(true)
    })

    it('组件已存在 → 直接返回，不下载不安装', async () => {
      const harness = createHarness()
      const entry = makePortableSoffice(harness)
      let downloaded = 0
      harness.deps.download = async () => {
        downloaded += 1
        return 'unused'
      }
      const result = (await runTask(harness, 'install', {})) as { path: string }
      expect(result.path).toBe(entry)
      expect(downloaded).toBe(0)
    })

    it('下载失败 → DOWNLOAD_FAILED 透传', async () => {
      const harness = createHarness()
      harness.deps.download = async () => {
        throw Object.assign(new Error('x'), { code: 'DOWNLOAD_FAILED', message: '下载失败' })
      }
      await expect(runTask(harness, 'install', {})).rejects.toMatchObject({
        code: 'DOWNLOAD_FAILED'
      })
    })

    it('msiexec 非零退出 → INSTALL_FAILED', async () => {
      const harness = createHarness()
      harness.deps.download = fakeDownload
      harness.deps.run = async () => okResult({ code: 1603, stderr: 'fatal error' })
      await expect(runTask(harness, 'install', {})).rejects.toMatchObject({
        code: 'INSTALL_FAILED',
        detail: 'fatal error'
      })
    })

    it('安装完成但无入口 → INSTALL_FAILED', async () => {
      const harness = createHarness()
      harness.deps.download = fakeDownload
      harness.deps.run = fakeMsiexec(harness, false)
      await expect(runTask(harness, 'install', {})).rejects.toMatchObject({
        code: 'INSTALL_FAILED'
      })
    })

    it('msiexec spawn 失败 → INSTALL_FAILED', async () => {
      const harness = createHarness()
      harness.deps.download = fakeDownload
      harness.deps.run = async () => {
        throw new SpawnError('spawn ENOENT', 'msiexec')
      }
      await expect(runTask(harness, 'install', {})).rejects.toMatchObject({
        code: 'INSTALL_FAILED',
        detail: 'msiexec'
      })
    })

    it('msiexec 抛普通错误 → 原样上抛', async () => {
      const harness = createHarness()
      harness.deps.download = fakeDownload
      harness.deps.run = async () => {
        throw new Error('boom')
      }
      await expect(runTask(harness, 'install', {})).rejects.toThrow('boom')
    })

    it('msiexec 回报 aborted → 任务中止', async () => {
      const harness = createHarness()
      harness.deps.download = fakeDownload
      harness.deps.run = async () => okResult({ aborted: true })
      await expect(runTask(harness, 'install', {})).rejects.toThrow('aborted')
    })

    it('msiexec 超时 → INSTALL_FAILED', async () => {
      const harness = createHarness()
      harness.deps.download = fakeDownload
      harness.deps.run = async () => okResult({ timedOut: true, code: null })
      await expect(runTask(harness, 'install', {})).rejects.toMatchObject({
        code: 'INSTALL_FAILED',
        detail: '超时 600 秒'
      })
    })

    it('下载期间信号中止 → 任务中止（安装前守卫）', async () => {
      const controller = new AbortController()
      const harness = createHarness()
      harness.deps.download = async (options) => {
        const path = await fakeDownload(options)
        controller.abort()
        return path
      }
      harness.deps.run = fakeMsiexec(harness, true)
      await expect(
        runTask(harness, 'install', {}, { signal: controller.signal })
      ).rejects.toThrow('aborted')
    })

    it('下载进度按 B/KiB/MiB/GiB 格式化', async () => {
      const harness = createHarness()
      harness.deps.download = async (options) => {
        options.onProgress?.(2 ** 30, 2 ** 20)
        options.onProgress?.(2 ** 20, 2048)
        options.onProgress?.(2048, 10)
        return fakeDownload(options)
      }
      harness.deps.run = fakeMsiexec(harness, true)
      const updates: TaskUpdate[] = []
      await runTask(harness, 'install', {}, { updates })
      const messages = updates
        .filter((update) => update.kind === 'progress' && update.stage === 'download')
        .map((update) => (update.kind === 'progress' ? update.message : ''))
      expect(messages).toContain('1.0 GiB / 1.0 MiB')
      expect(messages).toContain('1.0 MiB / 2.0 KiB')
      expect(messages).toContain('2.0 KiB / 10 B')
    })

    it('非对象 payload → INVALID_PAYLOAD', async () => {
      const harness = createHarness()
      await expect(runTask(harness, 'install', 'bad')).rejects.toMatchObject({
        code: 'INVALID_PAYLOAD'
      })
    })

    it('下载前创建安装暂存目录；创建失败 → INSTALL_FAILED', async () => {
      const created: string[] = []
      const harness = createHarness({
        makeDir: async (path) => {
          created.push(path)
        }
      })
      harness.deps.download = fakeDownload
      harness.deps.run = fakeMsiexec(harness, true)
      await runTask(harness, 'install', {})
      expect(created).toContain(join(harness.tempRoot, 'lumin-docx2pdf-install'))

      const failed = createHarness({
        makeDir: async () => {
          throw { code: 'ENOSPC' }
        }
      })
      await expect(runTask(failed, 'install', {})).rejects.toMatchObject({
        code: 'INSTALL_FAILED',
        detail: 'ENOSPC'
      })

      const plain = createHarness({
        makeDir: async () => {
          throw new Error('boom')
        }
      })
      await expect(runTask(plain, 'install', {})).rejects.toMatchObject({
        code: 'INSTALL_FAILED',
        detail: 'Error: boom'
      })
    })

    it('并发安装串行（install 互斥）', async () => {
      const harness = createHarness()
      let active = 0
      let maxActive = 0
      harness.deps.download = fakeDownload
      harness.deps.run = async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 30))
        active -= 1
        makePortableSoffice(harness)
        return okResult({ code: 0 })
      }
      const [first, second] = await Promise.all([
        runTask(harness, 'install', {}, { taskId: 'i-1' }),
        runTask(harness, 'install', {}, { taskId: 'i-2' })
      ])
      expect(maxActive).toBe(1)
      expect(first).toEqual(second)
    })
  })
})
