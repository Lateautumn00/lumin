/**
 * @file node.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description 文件打印主进程逻辑：预检与 Office 转 PDF（prepare）、系统打印对话框（show）、
 *              临时产物清理（cleanup）。打印窗口沿用壳安全基线（sandbox/contextIsolation/
 *              无 nodeIntegration/无 preload/禁止新窗口与导航）。所有外部能力经 deps 注入，便于单测。
 */
import { BrowserWindow } from 'electron'
import { accessSync, constants } from 'node:fs'
import {
  access,
  copyFile,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  runProcess,
  SpawnError,
  tail,
  type RunProcessOptions,
  type RunProcessResult
} from '@lumin/node-kit'
import {
  buildConvertArgs,
  convertDetail,
  locateSoffice,
  moveFile,
  pickSofficeCommand,
  precheckInput,
  producedPdfPath,
  sofficeMutex,
  verifyPdfOutput,
  type MoveFs
} from '@lumin/node-kit/office'
import { encodeCanvas, openPdf, renderPageToCanvas } from '@lumin/node-kit/pdf'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import { makeError, type StructuredError } from '@lumin/shared'
import { errnoCode, isStructuredError, toolError, type PrintErrorCode } from './errors'
import {
  MAX_INPUT_BYTES,
  MAX_PRINT_FILES,
  classifyPrintFile,
  dedupePaths,
  fileNameOf,
  isAbsolutePath,
  type PrintKind
} from './formats'
import { buildImageHtml, buildRasterHtml, isCancelledReason, isStaleJob } from './jobs'
import {
  cleanupPayloadSchema,
  preparePayloadSchema,
  showPayloadSchema,
  statusPayloadSchema,
  type CleanupResult,
  type PrepareResult,
  type PrintFailure,
  type PrintJob,
  type ShowResult,
  type StatusResult
} from './schema'

/** Office 转换超时（与 docx2pdf 一致：冷启动实测 12.3s，60s 上限） */
export const CONVERT_TIMEOUT_MS = 60_000

/** 打印窗口加载/等待对话框的统一进度文案（spec §3） */
const SHOW_PREPARING = '正在准备打印…'

/** 隐藏打印窗口的最小抽象（生产用 BrowserWindow，测试注入假件） */
export interface PrintWindow {
  /** 加载本地 file:// 页面（失败 reject） */
  load(url: string): Promise<void>
  /** 以非激活方式显示窗口（spike：隐藏窗口弹框慢 5s 以上） */
  reveal(): void
  /** 打开系统打印对话框；dryRunPath 非空时改走 printToPDF 落盘（e2e） */
  print(dryRunPath: string | null): Promise<{ success: boolean; reason?: string }>
  destroy(): void
}

/** 主进程依赖（node.ts 组装真实实现，测试注入假件） */
export interface PrintDeps {
  fileExists(path: string): boolean
  statSize(path: string): Promise<number>
  checkReadable(path: string): Promise<void>
  checkExclusive(path: string): Promise<void>
  readHead(path: string): Promise<string>
  makeDir(path: string): Promise<void>
  removeDir(path: string): Promise<void>
  writeText(path: string, text: string): Promise<void>
  listDir(path: string): Promise<{ name: string; mtimeMs: number }[]>
  move: MoveFs
  openPdf(path: string): Promise<{ pageCount: number }>
  rasterizeToHtml(sourcePath: string, outDir: string): Promise<string>
  queryRegistry(key: string): Promise<string | null>
  run(options: RunProcessOptions): Promise<RunProcessResult>
  createPrintWindow(): PrintWindow
  jobId(): string
  now(): number
  dryRun: boolean
}

/** 主进程内部的打印任务记录（产物目录与当前 URL 不外发） */
interface JobRecord extends PrintJob {
  dir: string
  printUrl: string
  fallbackTried: boolean
}

/** 打印临时根目录 */
export function printBaseDir(userData: string): string {
  return join(userData, 'temp', 'lumin-print')
}

/** 打印窗口的 file:// URL（含空格/中文/# 安全编码） */
export function toPrintUrl(path: string): string {
  return pathToFileURL(path).href
}

/** pdfjs 密码异常判定（node-kit/pdf 原样抛出） */
function isPasswordError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'PasswordException'
  )
}

/** 打印窗口装载失败映射：PDF 视为损坏，其余视为打印失败 */
function loadErrorOf(kind: PrintKind, err: unknown): StructuredError {
  return kind === 'pdf'
    ? toolError('PR_PDF_BROKEN', errnoCode(err) || String(err))
    : toolError('PR_PRINT_FAILED', String(err))
}

/** abort 与打印结果的竞速：取消时立即走取消分支，避免等待已被销毁窗口的回调 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(toolError('PR_PRINT_CANCELLED'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(toolError('PR_PRINT_CANCELLED'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    )
  })
}

/** 清理超过 24h 的残留任务目录（启动时最佳努力） */
export async function cleanupStaleJobs(baseDir: string, deps: PrintDeps): Promise<number> {
  const entries = await deps.listDir(baseDir)
  let removed = 0
  for (const entry of entries) {
    if (!isStaleJob(entry.mtimeMs, deps.now())) continue
    try {
      await deps.removeDir(join(baseDir, entry.name))
      removed += 1
    } catch {
      // 单目录失败不阻塞启动（AGENTS §13 由调用方记日志）
    }
  }
  return removed
}

/** 注册四个通道（status/cleanup sync；prepare/show 任务），可注入 deps 供测试 */
export function registerWith(ctx: MainPluginContext, deps: PrintDeps): void {
  const baseDir = printBaseDir(ctx.paths.userData)
  const portableProgramDir = join(ctx.paths.userData, 'libreoffice-portable', 'program')
  const jobs = new Map<string, JobRecord>()
  let activeShow: string | null = null

  async function currentStatus(): Promise<StatusResult> {
    const customPath = await ctx.settings.get('customPath', '')
    const locate = await locateSoffice({
      customPath,
      portableDir: portableProgramDir,
      queryRegistry: deps.queryRegistry,
      exists: deps.fileExists
    })
    return {
      soffice: {
        available: locate.path !== undefined,
        path: locate.path,
        customPath
      }
    }
  }

  ctx.registerIpc('status', async ({ payload }) => {
    const parsed = statusPayloadSchema.safeParse(payload ?? {})
    if (parsed.success && parsed.data.customPath !== undefined) {
      await ctx.settings.set('customPath', parsed.data.customPath.trim())
    }
    return currentStatus()
  })

  ctx.registerIpc('cleanup', async ({ payload }) => {
    const parsed = cleanupPayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '清理参数无效')
    const targets =
      parsed.data.jobIds === undefined
        ? [...jobs.keys()]
        : parsed.data.jobIds.filter((jobId) => jobs.has(jobId))
    let removed = 0
    for (const jobId of targets) {
      const job = jobs.get(jobId)
      if (job === undefined) continue
      jobs.delete(jobId)
      try {
        await deps.removeDir(job.dir)
        removed += 1
      } catch (err) {
        ctx.log.warn('清理打印临时目录失败', job.dir, err)
      }
    }
    return { removed } satisfies CleanupResult
  })

  /** 预检 PDF 并取页数（加密/损坏分别映射错误码） */
  async function pdfPageCount(path: string): Promise<number> {
    try {
      const opened = await deps.openPdf(path)
      return opened.pageCount
    } catch (err) {
      if (isPasswordError(err)) throw toolError('PR_PDF_PASSWORD')
      throw toolError('PR_PDF_BROKEN', errnoCode(err) || String(err))
    }
  }

  /** Office → PDF 并返回产物路径（串行锁由调用方持有） */
  async function convertOffice(args: {
    inputPath: string
    command: string
    jobDir: string
    signal: AbortSignal
  }): Promise<string> {
    const { inputPath, command, jobDir, signal } = args
    const workDir = join(jobDir, 'work')
    await deps.makeDir(workDir)
    try {
      if (signal.aborted) throw new Error('aborted')
      let result: RunProcessResult
      try {
        result = await deps.run({
          command,
          args: buildConvertArgs({
            inputPath,
            outDir: workDir,
            profileDir: join(workDir, 'profile')
          }),
          timeoutMs: CONVERT_TIMEOUT_MS,
          signal
        })
      } catch (err) {
        if (signal.aborted) throw err
        if (err instanceof SpawnError) throw toolError('PR_CONVERT_FAILED', err.command)
        throw toolError('PR_CONVERT_FAILED', String(err))
      }
      if (result.aborted || signal.aborted) throw new Error('aborted')
      if (result.timedOut) throw toolError('PR_CONVERT_TIMEOUT')
      if (result.code !== 0) {
        throw toolError('PR_CONVERT_FAILED', tail(convertDetail(result.stderr, result.stdout)))
      }
      const produced = producedPdfPath(workDir, inputPath)
      const valid = await verifyPdfOutput(produced, deps.readHead)
      if (!valid) {
        throw toolError('PR_CONVERT_FAILED', tail(convertDetail(result.stderr, result.stdout)))
      }
      const target = join(jobDir, 'print.pdf')
      await moveFile(produced, target, deps.move)
      return target
    } finally {
      try {
        await deps.removeDir(workDir)
      } catch (err) {
        ctx.log.warn('清理 Office 转换工作目录失败', workDir, err)
      }
    }
  }

  /** 单文件准备：预检 → 产物 → job 记录；失败抛结构化错误由批次收集 */
  async function prepareOne(args: {
    inputPath: string
    sofficeCommand: string | null
    signal: AbortSignal
  }): Promise<JobRecord> {
    const { inputPath, sofficeCommand, signal } = args
    if (!isAbsolutePath(inputPath)) throw toolError('PR_INVALID_PATH', inputPath)
    const kind = classifyPrintFile(inputPath)
    if (kind === null) throw toolError('PR_UNSUPPORTED_FORMAT', fileNameOf(inputPath))

    const precheck = await precheckInput(inputPath, deps)
    if (!precheck.ok) {
      throw toolError(precheck.kind === 'locked' ? 'PR_LOCKED' : 'PR_NOT_FOUND', precheck.detail)
    }
    let size: number
    try {
      size = await deps.statSize(inputPath)
    } catch (err) {
      throw toolError('PR_NOT_FOUND', errnoCode(err) || String(err))
    }
    if (size > MAX_INPUT_BYTES) throw toolError('PR_TOO_LARGE', `${size}`)

    const jobId = deps.jobId()
    const jobDir = join(baseDir, jobId)
    await deps.makeDir(jobDir)
    try {
      let pageCount: number | undefined
      let printUrl: string
      let sourcePath = inputPath

      if (kind === 'office') {
        if (sofficeCommand === null) throw toolError('PR_SOFFICE_MISSING')
        const pdfPath = await convertOffice({
          inputPath,
          command: sofficeCommand,
          jobDir,
          signal
        })
        sourcePath = pdfPath
        pageCount = await pdfPageCount(pdfPath)
        printUrl = toPrintUrl(pdfPath)
      } else if (kind === 'pdf') {
        pageCount = await pdfPageCount(inputPath)
        printUrl = toPrintUrl(inputPath)
      } else {
        const htmlPath = join(jobDir, 'print.html')
        await deps.writeText(
          htmlPath,
          buildImageHtml({ title: fileNameOf(inputPath), imageUrl: toPrintUrl(inputPath) })
        )
        printUrl = toPrintUrl(htmlPath)
      }

      const record: JobRecord = {
        jobId,
        name: fileNameOf(inputPath),
        sourcePath,
        kind,
        pageCount,
        dir: jobDir,
        printUrl,
        fallbackTried: false
      }
      jobs.set(jobId, record)
      return record
    } catch (err) {
      try {
        await deps.removeDir(jobDir)
      } catch (cleanupErr) {
        ctx.log.warn('清理失败任务目录失败', jobDir, cleanupErr)
      }
      throw err
    }
  }

  ctx.registerTask('prepare', async ({ payload, signal, emit }) => {
    const parsed = preparePayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '打印参数无效')
    const inputs = dedupePaths(parsed.data.inputPaths)
    if (inputs.length > MAX_PRINT_FILES) {
      throw toolError('PR_TOO_MANY_FILES', `${inputs.length}`)
    }

    const hasOffice = inputs.some((path) => classifyPrintFile(path) === 'office')
    let sofficeCommand: string | null = null
    if (hasOffice) {
      emit({
        kind: 'progress',
        current: 0,
        total: inputs.length,
        stage: 'locate',
        message: '定位转换组件…'
      })
      const customPath = await ctx.settings.get('customPath', '')
      const locate = await locateSoffice({
        customPath,
        portableDir: portableProgramDir,
        queryRegistry: deps.queryRegistry,
        exists: deps.fileExists
      })
      const picked = locate.path === undefined ? null : pickSofficeCommand(locate.path)
      if (picked === null) throw toolError('PR_SOFFICE_MISSING')
      sofficeCommand = picked
    }

    if (hasOffice) await sofficeMutex.acquire(signal)
    try {
      const ready: PrintJob[] = []
      const failures: PrintFailure[] = []
      for (const [index, inputPath] of inputs.entries()) {
        if (signal.aborted) throw new Error('aborted')
        emit({
          kind: 'progress',
          current: index,
          total: inputs.length,
          stage: 'prepare',
          message: `正在准备第 ${index + 1}/${inputs.length} 份…`
        })
        try {
          const job = await prepareOne({ inputPath, sofficeCommand, signal })
          ready.push({
            jobId: job.jobId,
            name: job.name,
            sourcePath: job.sourcePath,
            kind: job.kind,
            pageCount: job.pageCount
          })
        } catch (err) {
          if (signal.aborted) throw err
          const structured = isStructuredError(err)
            ? err
            : toolError('PR_PRINT_FAILED', String(err))
          failures.push({
            inputPath,
            code: structured.code,
            message: structured.message,
            detail: structured.detail
          })
        }
      }
      const firstFailure = failures[0]
      if (ready.length === 0 && firstFailure !== undefined) {
        throw toolError(firstFailure.code as PrintErrorCode, firstFailure.detail)
      }
      emit({
        kind: 'progress',
        current: inputs.length,
        total: inputs.length,
        stage: 'done',
        message: '准备完成'
      })
      return { jobs: ready, failures } satisfies PrepareResult
    } finally {
      if (hasOffice) sofficeMutex.release()
    }
  })

  ctx.registerTask('show', async ({ payload, signal, emit }) => {
    const parsed = showPayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '打印参数无效')
    const job = jobs.get(parsed.data.jobId)
    if (job === undefined) throw toolError('PR_NOT_FOUND', parsed.data.jobId)
    if (activeShow !== null) throw toolError('PR_PRINT_BUSY')

    activeShow = job.jobId
    let win: PrintWindow | null = deps.createPrintWindow()
    const onAbort = (): void => {
      win?.destroy()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      emit({ kind: 'progress', current: 0, total: 1, stage: 'load', message: SHOW_PREPARING })
      try {
        await win.load(job.printUrl)
      } catch (err) {
        // PDFium 装载失败 → 栅格兜底一次（spec §7）
        if (job.kind !== 'pdf' || job.fallbackTried) throw loadErrorOf(job.kind, err)
        job.fallbackTried = true
        const htmlPath = await deps.rasterizeToHtml(job.sourcePath, job.dir)
        job.printUrl = toPrintUrl(htmlPath)
        win.destroy()
        win = deps.createPrintWindow()
        try {
          await win.load(job.printUrl)
        } catch (fallbackErr) {
          throw loadErrorOf(job.kind, fallbackErr)
        }
      }
      if (signal.aborted) throw toolError('PR_PRINT_CANCELLED')
      win.reveal()
      emit({
        kind: 'progress',
        current: 0,
        total: 1,
        stage: 'dialog',
        message: `请在系统打印对话框中确认（${job.name}）…`
      })
      const dryRunPath = deps.dryRun ? join(job.dir, 'dry-run.pdf') : null
      const outcome = await raceAbort(win.print(dryRunPath), signal)
      if (signal.aborted) throw toolError('PR_PRINT_CANCELLED')
      if (!outcome.success) {
        if (isCancelledReason(outcome.reason)) throw toolError('PR_PRINT_CANCELLED')
        throw toolError('PR_PRINT_FAILED', outcome.reason)
      }
      return {
        jobId: job.jobId,
        name: job.name,
        pageCount: job.pageCount
      } satisfies ShowResult
    } finally {
      signal.removeEventListener('abort', onAbort)
      try {
        win.destroy()
      } catch (err) {
        ctx.log.warn('销毁打印窗口失败', err)
      }
      win = null
      activeShow = null
    }
  })
}

/** 生产实现：node:fs + soffice/pdfjs/原生画布 + Windows 打印对话框 */
export function createNodeDeps(): PrintDeps {
  const dryRun =
    process.env['LUMIN_PRINT_DRY_RUN'] === '1' || process.argv.includes('--lumin-print-dry-run')

  return {
    fileExists: (path) => {
      try {
        accessSync(path, constants.F_OK)
        return true
      } catch {
        return false
      }
    },
    statSize: async (path) => (await stat(path)).size,
    checkReadable: (path) => access(path, constants.R_OK),
    // 读方式打开探测共享冲突（独占句柄会拒绝任何打开；只读文件不受影响）
    checkExclusive: async (path) => {
      const handle = await open(path, 'r')
      await handle.close()
    },
    readHead: async (path) => {
      const handle = await open(path, 'r')
      try {
        const buffer = Buffer.alloc(5)
        await handle.read(buffer, 0, 5, 0)
        return buffer.toString('latin1')
      } finally {
        await handle.close()
      }
    },
    makeDir: async (path) => {
      await mkdir(path, { recursive: true })
    },
    removeDir: async (path) => {
      await rm(path, { recursive: true, force: true })
    },
    writeText: async (path, text) => {
      await writeFile(path, text, 'utf8')
    },
    listDir: async (path) => {
      let entries: string[]
      try {
        entries = await readdir(path)
      } catch {
        return []
      }
      const result: { name: string; mtimeMs: number }[] = []
      for (const name of entries) {
        try {
          const info = await stat(join(path, name))
          result.push({ name, mtimeMs: info.mtimeMs })
        } catch {
          // 并发删除等导致的瞬时失败跳过
        }
      }
      return result
    },
    move: {
      rename: async (from, to) => {
        await rename(from, to)
      },
      copyFile: async (from, to) => {
        await copyFile(from, to)
      },
      unlink: async (path) => {
        await unlink(path)
      }
    },
    openPdf: async (path) => {
      const opened = await openPdf(path)
      try {
        return { pageCount: opened.pageCount }
      } finally {
        await opened.doc.cleanup()
      }
    },
    rasterizeToHtml: async (sourcePath, outDir) => {
      const opened = await openPdf(sourcePath)
      const urls: string[] = []
      try {
        for (let pageNumber = 1; pageNumber <= opened.pageCount; pageNumber += 1) {
          const rendered = await renderPageToCanvas(opened.doc, pageNumber, { scale: 2 })
          const bytes = await encodeCanvas(rendered.canvas, 'png')
          const file = join(outDir, `page-${String(pageNumber).padStart(3, '0')}.png`)
          await writeFile(file, bytes)
          urls.push(toPrintUrl(file))
        }
      } finally {
        await opened.doc.cleanup()
      }
      const htmlPath = join(outDir, 'print.html')
      await writeFile(
        htmlPath,
        buildRasterHtml({ title: basename(sourcePath), imageUrls: urls }),
        'utf8'
      )
      return htmlPath
    },
    queryRegistry: async (key) => {
      try {
        const result = await runProcess({
          command: 'reg',
          args: ['query', key],
          encoding: 'gbk',
          timeoutMs: 5000,
          maxOutputChars: 8192
        })
        if (result.code !== 0) return null
        const match = /InstallPath\s+REG_SZ\s+(.+)/i.exec(result.stdout)
        return match?.[1]?.trim() ?? null
      } catch {
        return null
      }
    },
    run: runProcess,
    createPrintWindow: () => createBrowserPrintWindow(),
    jobId: () => `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    now: () => Date.now(),
    dryRun
  }
}

/** 真实隐藏打印窗口：沿用主窗口安全基线，PDF 需 plugins:true */
export function createBrowserPrintWindow(): PrintWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 1200,
    show: false,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event: Electron.Event) => {
    event.preventDefault()
  })
  return {
    load: async (url) => {
      await win.loadURL(url)
    },
    reveal: () => {
      win.showInactive()
    },
    print: async (dryRunPath) => {
      if (dryRunPath !== null) {
        const data = await win.webContents.printToPDF({ printBackground: true })
        await writeFile(dryRunPath, data)
        return { success: true }
      }
      return new Promise((resolve) => {
        win.webContents.print({ silent: false }, (success: boolean, failureReason: string) => {
          resolve(
            failureReason === undefined || failureReason === ''
              ? { success }
              : { success, reason: failureReason }
          )
        })
      })
    },
    destroy: () => {
      if (!win.isDestroyed()) win.destroy()
    }
  }
}

export const registerMain: RegisterMain = async (ctx) => {
  const deps = createNodeDeps()
  await cleanupStaleJobs(printBaseDir(ctx.paths.userData), deps)
  registerWith(ctx, deps)
}
