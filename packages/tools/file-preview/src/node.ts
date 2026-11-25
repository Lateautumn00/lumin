/**
 * @file file-preview 主进程逻辑（inspect/read-text/asset-url/convert-office/
 *       render-pdf-page/release-preview/soffice-status/set-soffice-path）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 文本与图片经同步通道返回；PDF 由主进程 pdfjs 渲染为 PNG（renderer 不打包 pdfjs）；
 *              Office 走可取消任务，soffice 串行（mutex）+ 60s 超时，临时 PDF 落
 *              `ctx.paths.temp/lumin-file-preview/<taskId>.pdf`，启动清理 >24h。
 */
import { randomUUID } from 'node:crypto'
import { accessSync, constants, statSync } from 'node:fs'
import { access, copyFile, mkdir, open, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  runProcess,
  SpawnError,
  tail,
  type RunProcessOptions,
  type RunProcessResult
} from '@lumin/node-kit'
import {
  buildConvertArgs,
  classifyConvertFailure,
  convertDetail,
  locateSoffice,
  moveFile,
  parseRegistryInstallPath,
  pickSofficeCommand,
  precheckInput,
  producedPdfPath,
  sofficeMutex,
  taskWorkDir,
  verifyPdfOutput,
  type MoveFs
} from '@lumin/node-kit/office'
import {
  encodeCanvas,
  openPdf,
  renderPageToCanvas,
  type OpenedPdf,
  type PdfDocumentHandle,
  type RenderedCanvas
} from '@lumin/node-kit/pdf'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import {
  detectEol,
  detectTextEncoding,
  errnoCode,
  isStructuredError,
  makeError,
  stripBom,
  toMediaUrl,
  type StructuredError,
  type TextEncoding,
  type TaskUpdate
} from '@lumin/shared'
import type { ZodType } from 'zod'
import { toolError } from './errors'
import { detectKind, extensionOf } from './formats'
import {
  MAX_TEXT_BYTES,
  DEFAULT_PAGE_SCALE,
  assetUrlPayloadSchema,
  assetUrlResultSchema,
  convertOfficePayloadSchema,
  convertOfficeResultSchema,
  inspectPayloadSchema,
  inspectResultSchema,
  readTextPayloadSchema,
  readTextResultSchema,
  releasePreviewPayloadSchema,
  releasePreviewResultSchema,
  renderPdfPagePayloadSchema,
  renderPdfPageResultSchema,
  setSofficePathPayloadSchema,
  sofficeStatusResultSchema,
  type ConvertOfficePayload,
  type ConvertOfficeResult,
  type InspectResult,
  type SofficeStatusResult
} from './schema'

/** Office 转换超时（spec §6：60s） */
export const CONVERT_TIMEOUT_MS = 60_000

/** 临时 PDF 保留时长（启动清理 >24h，spec §6） */
export const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** 设置键：自定义 soffice 路径（settings 命名空间由壳按工具 id 隔离） */
const SOFFICE_SETTINGS_KEY = 'sofficePath'

/** 临时清理所需的最小依赖（单测注入假件） */
export interface TempCleanupDeps {
  now(): number
  listDir(path: string): Promise<string[]>
  statSync(path: string): { mtimeMs: number; isFile(): boolean }
  unlink(path: string): Promise<void>
}

/** 工具可用的外部资源（生产实现见 createNodeDeps；测试注入假件） */
export interface FilePreviewDeps extends TempCleanupDeps {
  stat(path: string): Promise<{ size: number; isFile(): boolean }>
  readBytes(path: string, length: number): Promise<Uint8Array>
  openPdf: (path: string) => Promise<OpenedPdf>
  renderPage: (
    doc: PdfDocumentHandle,
    page: number,
    options: { scale: number }
  ) => Promise<RenderedCanvas>
  encodePng: (canvas: RenderedCanvas['canvas']) => Promise<Buffer>
  fileExists(path: string): boolean
  queryRegistry(key: string): Promise<string | null>
  runProcess(options: RunProcessOptions): Promise<RunProcessResult>
  checkReadable(path: string): Promise<void>
  checkExclusive(path: string): Promise<void>
  makeDir(path: string): Promise<void>
  removeDir(path: string): Promise<void>
  move: MoveFs
  readHead(path: string): Promise<string>
}

/** 已打开的 PDF 预览会话（release-preview 释放；Office 产物随会话删除） */
interface PreviewEntry {
  doc: PdfDocumentHandle
  filePath: string
  pageCount: number
  ownsTemp: boolean
}

/** 临时预览目录（spec §6） */
export function previewTempDir(tempRoot: string): string {
  return join(tempRoot, 'lumin-file-preview')
}

/** 单任务临时 PDF 路径（spec §6） */
export function tempPdfPath(tempRoot: string, taskId: string): string {
  return join(previewTempDir(tempRoot), `${taskId}.pdf`)
}

/** 新预览会话 id */
export function newPreviewId(): string {
  return `fp-${randomUUID()}`
}

/**
 * 是否超过保留时长
 * @param mtimeMs 文件修改时间（毫秒）
 * @param nowMs 当前时间（毫秒）
 * @param maxAgeMs 保留时长（毫秒）
 */
export function isStaleTemp(mtimeMs: number, nowMs: number, maxAgeMs: number): boolean {
  return nowMs - mtimeMs > maxAgeMs
}

/**
 * 清理临时目录内超过 24h 的 PDF（启动执行；失败项静默跳过）
 * @param root 临时预览目录
 * @param deps 注入依赖
 */
export async function cleanupTempPdfs(root: string, deps: TempCleanupDeps): Promise<number> {
  let names: string[]
  try {
    names = await deps.listDir(root)
  } catch {
    return 0
  }
  const now = deps.now()
  let removed = 0
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.pdf')) continue
    const filePath = join(root, name)
    let info: { mtimeMs: number; isFile(): boolean }
    try {
      info = deps.statSync(filePath)
    } catch {
      continue
    }
    if (!info.isFile() || !isStaleTemp(info.mtimeMs, now, TEMP_MAX_AGE_MS)) continue
    try {
      await deps.unlink(filePath)
      removed += 1
    } catch {
      // 占用/权限异常不影响启动
    }
  }
  return removed
}

/**
 * 字节 → 文本（按判定编码解码，去除 BOM 残留）
 * @param bytes 原始字节
 * @param encoding 编码判定结果
 */
export function decodeTextBytes(bytes: Uint8Array, encoding: TextEncoding): string {
  const label =
    encoding === 'gbk'
      ? 'gbk'
      : encoding === 'utf16le'
        ? 'utf-16le'
        : encoding === 'utf16be'
          ? 'utf-16be'
          : 'utf-8'
  return stripBom(new TextDecoder(label).decode(bytes))
}

/** errno → 结构化错误码（不存在/被占用/其余读取失败） */
function classifyFsError(err: unknown): StructuredError {
  const code = errnoCode(err)
  if (code === 'ENOENT') return toolError('FP_NOT_FOUND', code)
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    return toolError('FP_LOCKED', code)
  }
  return toolError('FP_READ_FAILED', code)
}

/** PDF 打开失败 → 结构化错误（加密单独成码） */
function classifyPdfOpenError(err: unknown): StructuredError {
  if (isStructuredError(err)) return err
  const name = err instanceof Error ? err.name : ''
  const message = err instanceof Error ? err.message : String(err)
  if (name === 'PasswordException' || /password/i.test(message)) {
    return toolError('FP_PDF_PASSWORD')
  }
  return toolError('FP_READ_FAILED', tail(message))
}

/** zod 校验：失败统一 INVALID_PAYLOAD */
function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw makeError('INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '参数无效')
  }
  return parsed.data
}

/**
 * 注册 file-preview 全部通道（工具注册入口，可注入 deps 供测试）
 * @param ctx 主进程插件上下文（paths/settings/log/registerIpc/registerTask）
 * @param deps 可注入依赖
 */
export function registerWith(ctx: MainPluginContext, deps: FilePreviewDeps): void {
  const portableProgramDir = join(ctx.paths.userData, 'libreoffice-portable', 'program')
  const previews = new Map<string, PreviewEntry>()

  void cleanupTempPdfs(previewTempDir(ctx.paths.temp), deps).catch((err: unknown) => {
    ctx.log.warn('清理临时预览文件失败', err)
  })

  /** 当前 soffice 状态（自定义 → 注册表 → 便携目录，spec §4） */
  async function currentSofficeStatus(): Promise<SofficeStatusResult> {
    const customPath = await ctx.settings.get<string>(SOFFICE_SETTINGS_KEY, '')
    const locate = await locateSoffice({
      customPath,
      portableDir: portableProgramDir,
      queryRegistry: deps.queryRegistry,
      exists: deps.fileExists
    })
    if (locate.path === undefined) {
      return sofficeStatusResultSchema.parse({ found: false })
    }
    return sofficeStatusResultSchema.parse({ found: true, path: locate.path })
  }

  // —— inspect（sync）：类型判定 + 体积；PDF 顺带打开并登记预览会话 ——
  ctx.registerIpc('inspect', async ({ payload }): Promise<InspectResult> => {
    const { path } = parseOrThrow(inspectPayloadSchema, payload)
    const ext = extensionOf(path)
    const kind = detectKind(path)
    if (ext === null || kind === 'unsupported') throw toolError('FP_UNSUPPORTED', ext ?? '')

    let info: { size: number; isFile(): boolean }
    try {
      info = await deps.stat(path)
    } catch (err) {
      throw classifyFsError(err)
    }
    if (!info.isFile()) throw toolError('FP_INVALID_PATH')

    const previewId = newPreviewId()
    let pageCount: number | undefined
    if (kind === 'pdf') {
      try {
        const opened = await deps.openPdf(path)
        pageCount = opened.pageCount
        previews.set(previewId, {
          doc: opened.doc,
          filePath: path,
          pageCount,
          ownsTemp: false
        })
      } catch (err) {
        throw classifyPdfOpenError(err)
      }
    }

    const result: InspectResult = {
      previewId,
      kind,
      ext,
      name: basename(path),
      size: info.size
    }
    if (pageCount !== undefined) result.pageCount = pageCount
    return inspectResultSchema.parse(result)
  })

  // —— read-text（sync）：文本类文件按 2MiB 截断读取 + 编码/EOL 判定 ——
  ctx.registerIpc('read-text', async ({ payload }) => {
    const { path, maxBytes } = parseOrThrow(readTextPayloadSchema, payload)
    const kind = detectKind(path)
    if (kind !== 'text' && kind !== 'markdown' && kind !== 'html' && kind !== 'json' && kind !== 'csv') {
      throw toolError('FP_UNSUPPORTED', extensionOf(path) ?? '')
    }

    let info: { size: number; isFile(): boolean }
    try {
      info = await deps.stat(path)
    } catch (err) {
      throw classifyFsError(err)
    }
    if (!info.isFile()) throw toolError('FP_INVALID_PATH')

    const limit = maxBytes ?? MAX_TEXT_BYTES
    let bytes: Uint8Array
    try {
      bytes = await deps.readBytes(path, limit)
    } catch (err) {
      throw classifyFsError(err)
    }

    const encoding = detectTextEncoding(bytes)
    let text: string
    try {
      text = decodeTextBytes(bytes, encoding)
    } catch (err) {
      throw toolError(
        'FP_TEXT_DECODE_FAILED',
        tail(err instanceof Error ? err.message : String(err))
      )
    }

    return readTextResultSchema.parse({
      text,
      encoding,
      eol: detectEol(text),
      truncated: info.size > limit
    })
  })

  // —— asset-url（sync）：图片 → lumin-media:// URL（renderer <img> 展示；dev 下 file:// 会被拦截） ——
  ctx.registerIpc('asset-url', async ({ payload }) => {
    const { path } = parseOrThrow(assetUrlPayloadSchema, payload)
    if (detectKind(path) !== 'image') throw toolError('FP_UNSUPPORTED', extensionOf(path) ?? '')
    let info: { size: number; isFile(): boolean }
    try {
      info = await deps.stat(path)
    } catch (err) {
      throw classifyFsError(err)
    }
    if (!info.isFile()) throw toolError('FP_INVALID_PATH')
    return assetUrlResultSchema.parse({ url: toMediaUrl(path) })
  })

  // —— soffice-status（sync）：三级定位当前结果 ——
  ctx.registerIpc('soffice-status', async () => currentSofficeStatus())

  // —— set-soffice-path（sync）：自定义路径记忆 + 立即复核 ——
  ctx.registerIpc('set-soffice-path', async ({ payload }) => {
    const { path } = parseOrThrow(setSofficePathPayloadSchema, payload)
    await ctx.settings.set(SOFFICE_SETTINGS_KEY, path)
    return currentSofficeStatus()
  })

  // —— render-pdf-page（sync）：主进程渲染单页 → PNG base64 ——
  ctx.registerIpc('render-pdf-page', async ({ payload }) => {
    const parsed = parseOrThrow(renderPdfPagePayloadSchema, payload)
    const entry = previews.get(parsed.previewId)
    if (entry === undefined) {
      throw toolError('FP_PDF_RENDER_FAILED', '预览会话已失效，请重新打开文件')
    }
    if (parsed.page > entry.pageCount) {
      throw toolError('FP_PDF_RENDER_FAILED', `页码超出范围（共 ${entry.pageCount} 页）`)
    }
    let rendered: RenderedCanvas
    try {
      rendered = await deps.renderPage(entry.doc, parsed.page, {
        scale: parsed.scale ?? DEFAULT_PAGE_SCALE
      })
    } catch (err) {
      throw toolError(
        'FP_PDF_RENDER_FAILED',
        tail(err instanceof Error ? err.message : String(err))
      )
    }
    let png: Buffer
    try {
      png = await deps.encodePng(rendered.canvas)
    } catch (err) {
      throw toolError(
        'FP_PDF_RENDER_FAILED',
        tail(err instanceof Error ? err.message : String(err))
      )
    }
    return renderPdfPageResultSchema.parse({
      png: png.toString('base64'),
      width: rendered.width,
      height: rendered.height
    })
  })

  // —— release-preview（sync）：释放 PDF 会话，删除 Office 临时产物 ——
  ctx.registerIpc('release-preview', async ({ payload }) => {
    const { previewId } = parseOrThrow(releasePreviewPayloadSchema, payload)
    const entry = previews.get(previewId)
    if (entry === undefined) return releasePreviewResultSchema.parse({ released: false })
    previews.delete(previewId)
    try {
      await entry.doc.cleanup()
    } catch (err) {
      ctx.log.warn('释放 PDF 预览失败', previewId, err)
    }
    if (entry.ownsTemp) {
      try {
        await deps.unlink(entry.filePath)
      } catch (err) {
        ctx.log.warn('删除临时预览 PDF 失败', entry.filePath, err)
      }
    }
    return releasePreviewResultSchema.parse({ released: true })
  })

  // —— convert-office（task）：预检 → 串行 soffice → 产物校验 → 打开为预览 ——
  ctx.registerTask<ConvertOfficePayload, ConvertOfficeResult>(
    'convert-office',
    async (taskCtx) => {
      const { path } = parseOrThrow(convertOfficePayloadSchema, taskCtx.payload)
      if (detectKind(path) !== 'office') {
        throw toolError('FP_UNSUPPORTED', extensionOf(path) ?? '')
      }

      const precheck = await precheckInput(path, deps)
      if (!precheck.ok) {
        throw toolError(precheck.kind === 'locked' ? 'FP_LOCKED' : 'FP_NOT_FOUND', precheck.detail)
      }

      await sofficeMutex.acquire(taskCtx.signal)
      const target = tempPdfPath(ctx.paths.temp, taskCtx.taskId)
      const workDir = taskWorkDir(ctx.paths.temp, taskCtx.taskId, 'lumin-file-preview-work')
      try {
        if (taskCtx.signal.aborted) throw new Error('aborted')
        const status = await currentSofficeStatus()
        if (!status.found || status.path === undefined) throw toolError('FP_SOFFICE_MISSING')
        const command = pickSofficeCommand(status.path)
        if (command === null) throw toolError('FP_CONVERT_FAILED', status.path)

        await deps.makeDir(previewTempDir(ctx.paths.temp))
        await deps.makeDir(workDir)

        taskCtx.emit({
          kind: 'progress',
          current: 0,
          total: 100,
          stage: 'convert',
          message: '正在转换为 PDF…'
        } as TaskUpdate)

        const args = buildConvertArgs({
          inputPath: path,
          outDir: workDir,
          profileDir: join(workDir, 'profile')
        })
        let result: RunProcessResult
        try {
          result = await deps.runProcess({
            command,
            args,
            timeoutMs: CONVERT_TIMEOUT_MS,
            signal: taskCtx.signal
          })
        } catch (err) {
          if (err instanceof SpawnError) throw toolError('FP_CONVERT_FAILED', err.command)
          throw err
        }
        if (result.aborted || taskCtx.signal.aborted) throw new Error('aborted')
        if (result.timedOut) throw toolError('FP_CONVERT_TIMEOUT')
        if (result.code !== 0) {
          const failure = classifyConvertFailure(result.stderr)
          throw toolError(
            'FP_CONVERT_FAILED',
            failure === 'load'
              ? '源文件无法加载'
              : tail(convertDetail(result.stderr, result.stdout))
          )
        }

        const produced = producedPdfPath(workDir, path)
        const valid = await verifyPdfOutput(produced, deps.readHead)
        if (!valid) throw toolError('FP_CONVERT_FAILED', '转换未生成有效 PDF')

        await moveFile(produced, target, deps.move)

        let opened: OpenedPdf
        try {
          opened = await deps.openPdf(target)
        } catch (err) {
          throw classifyPdfOpenError(err)
        }
        const previewId = newPreviewId()
        previews.set(previewId, {
          doc: opened.doc,
          filePath: target,
          pageCount: opened.pageCount,
          ownsTemp: true
        })
        taskCtx.emit({
          kind: 'progress',
          current: 100,
          total: 100,
          stage: 'done',
          message: '转换完成'
        } as TaskUpdate)
        return convertOfficeResultSchema.parse({ previewId, pageCount: opened.pageCount })
      } catch (err) {
        // 失败/取消：临时 PDF 不保留（成功路径不进入 catch）
        await deps.unlink(target).catch(() => undefined)
        throw err
      } finally {
        try {
          await deps.removeDir(workDir)
        } catch (err) {
          ctx.log.warn('清理 Office 转换工作目录失败', workDir, err)
        }
        sofficeMutex.release()
      }
    }
  )

  ctx.log.info('file-preview registered', { portableProgramDir })
}

/** 生产实现：node:fs + reg 查询 + pdfjs 渲染（测试可作基底再覆盖） */
export function createNodeDeps(): FilePreviewDeps {
  return {
    now: () => Date.now(),
    stat: async (path) => {
      const info = await stat(path)
      return { size: info.size, isFile: () => info.isFile() }
    },
    readBytes: async (path, length) => {
      const handle = await open(path, 'r')
      try {
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, 0)
        return buffer.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
    },
    openPdf: (path) => openPdf(path),
    renderPage: (doc, page, options) => renderPageToCanvas(doc, page, options),
    encodePng: (canvas) => encodeCanvas(canvas, 'png'),
    fileExists: (path) => {
      try {
        accessSync(path, constants.F_OK)
        return true
      } catch {
        return false
      }
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
        return result.code === 0 ? parseRegistryInstallPath(result.stdout) : null
      } catch {
        return null
      }
    },
    runProcess,
    checkReadable: (path) => access(path, constants.R_OK),
    checkExclusive: async (path) => {
      const handle = await open(path, 'r')
      await handle.close()
    },
    makeDir: async (path) => {
      await mkdir(path, { recursive: true })
    },
    removeDir: async (path) => {
      await rm(path, { recursive: true, force: true })
    },
    move: { rename, copyFile, unlink },
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
    listDir: (path) => readdir(path),
    statSync: (path) => {
      const info = statSync(path)
      return { mtimeMs: info.mtimeMs, isFile: () => info.isFile() }
    },
    unlink: (path) => unlink(path)
  }
}

/** 壳注册入口（plugin-host 调用） */
export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
