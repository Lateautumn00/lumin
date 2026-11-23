import { accessSync, constants } from 'node:fs'
import { access, copyFile, mkdir, open, rename, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
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
  createMutex,
  locateSoffice,
  moveFile,
  parseRegistryInstallPath,
  pickSofficeCommand,
  precheckInput,
  probeSofficeDir,
  producedPdfPath,
  sofficeMutex,
  taskWorkDir,
  verifyPdfOutput,
  type MoveFs
} from '@lumin/node-kit/office'
import type { MainPluginContext, RegisterMain, TaskHandlerContext } from '@lumin/plugin-api'
import { makeError } from '@lumin/shared'
import { batchProgressMessage, dedupeInputPaths, toBatchFailure } from './batch'
import { downloadMsi, type DownloadOptions } from './download'
import { convertFailureCode, toolError, errnoCode, isStructuredError } from './errors'
import { OFFICE_INPUT_HINT } from './formats'
import { resolveOutputPath } from './naming'
import {
  convertPayloadSchema,
  installPayloadSchema,
  setPathPayloadSchema,
  type BatchConvertResult,
  type BatchFailure,
  type BatchOutput,
  type StatusResult
} from './schema'

/** 转换超时（spike 实测冷启动 12.3s，60s 上限） */
export const CONVERT_TIMEOUT_MS = 60_000
/** 静默安装超时（376MB MSI 解包） */
export const INSTALL_TIMEOUT_MS = 600_000

/** 工具可用的外部资源（node.ts 组装真实实现，测试注入假件） */
export interface Docx2pdfDeps {
  fileExists(path: string): boolean
  queryRegistry(key: string): Promise<string | null>
  run(options: RunProcessOptions): Promise<RunProcessResult>
  download(options: DownloadOptions): Promise<string>
  checkReadable(path: string): Promise<void>
  checkExclusive(path: string): Promise<void>
  readHead(path: string): Promise<string>
  makeDir(path: string): Promise<void>
  removeDir(path: string): Promise<void>
  move: MoveFs
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${bytes} B`
}

function spawnDetail(err: SpawnError): string {
  return err.command
}

/** 注册四个通道（status/set-path sync；convert/install 任务），可注入 deps 供测试 */
export function registerWith(ctx: MainPluginContext, deps: Docx2pdfDeps): void {
  const portableProgramDir = join(ctx.paths.userData, 'libreoffice-portable', 'program')
  const installWorkDir = join(ctx.paths.temp, 'lumin-docx2pdf-install')
  const convertMutex = sofficeMutex
  const installMutex = createMutex()

  async function currentStatus(): Promise<StatusResult> {
    const customPath = await ctx.settings.get('customPath', '')
    const locate = await locateSoffice({
      customPath,
      portableDir: portableProgramDir,
      queryRegistry: deps.queryRegistry,
      exists: deps.fileExists
    })
    return {
      source: locate.source,
      ...(locate.path !== undefined ? { path: locate.path } : {}),
      customInvalid: locate.customInvalid === true,
      customPath
    }
  }

  ctx.registerIpc('status', async () => currentStatus())

  ctx.registerIpc('set-path', async ({ payload }) => {
    const parsed = setPathPayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '路径参数无效')
    await ctx.settings.set('customPath', parsed.data.path)
    return currentStatus()
  })

  /**
   * 单文件转换流水线：预检 → 转换 → 产物校验 → 移入输入同目录。
   * 批量内按序号使用独立工作目录，避免不同目录同名基名产物互串。
   */
  async function convertOne(args: {
    inputPath: string
    command: string
    workDir: string
    index: number
    total: number
    signal: AbortSignal
    emit: TaskHandlerContext<unknown>['emit']
  }): Promise<string> {
    const { inputPath, command, workDir, index, total, signal, emit } = args
    const precheck = await precheckInput(inputPath, deps)
    if (!precheck.ok) {
      throw toolError(
        precheck.kind === 'locked' ? 'INPUT_LOCKED' : 'INPUT_NOT_FOUND',
        precheck.detail
      )
    }

    const outputPath = resolveOutputPath(inputPath, deps.fileExists)
    if (outputPath === null) throw toolError('OUTPUT_MISSING', '同名输出已存在 99 个')

    try {
      await deps.makeDir(workDir)
    } catch (err) {
      if (isStructuredError(err)) throw err
      throw toolError('OUTPUT_WRITE_FAILED', errnoCode(err) || String(err))
    }
    try {
      emit({
        kind: 'progress',
        current: index + 1,
        total,
        stage: 'convert',
        message: batchProgressMessage(index, total, inputPath)
      })
      const convertArgs = buildConvertArgs({
        inputPath,
        outDir: workDir,
        profileDir: join(workDir, 'profile')
      })
      if (signal.aborted) throw new Error('aborted')
      let result: RunProcessResult
      try {
        result = await deps.run({
          command,
          args: convertArgs,
          timeoutMs: CONVERT_TIMEOUT_MS,
          signal
        })
      } catch (err) {
        if (err instanceof SpawnError) throw toolError('SPAWN_FAILED', spawnDetail(err))
        throw err
      }
      if (result.aborted || signal.aborted) throw new Error('aborted')
      if (result.timedOut) throw toolError('CONVERT_TIMEOUT')
      if (result.code !== 0) {
        throw toolError(
          convertFailureCode(result.stderr),
          tail(convertDetail(result.stderr, result.stdout))
        )
      }

      const produced = producedPdfPath(workDir, inputPath)
      const valid = await verifyPdfOutput(produced, deps.readHead)
      if (!valid) {
        throw toolError('OUTPUT_MISSING', tail(convertDetail(result.stderr, result.stdout)))
      }
      try {
        await moveFile(produced, outputPath, deps.move)
      } catch (err) {
        if (isStructuredError(err)) throw err
        throw toolError('OUTPUT_WRITE_FAILED', errnoCode(err) || String(err))
      }
      return outputPath
    } finally {
      // spec §7.4：清理失败仅记日志，不阻塞结果（AGENTS §13）
      try {
        await deps.removeDir(workDir)
      } catch (err) {
        ctx.log.warn('清理转换工作目录失败', workDir, err)
      }
    }
  }

  ctx.registerTask('convert', async ({ payload, taskId, signal, emit }) => {
    const parsed = convertPayloadSchema.safeParse(payload)
    if (!parsed.success) {
      throw makeError('INVALID_PAYLOAD', `仅支持 ${OFFICE_INPUT_HINT} 文件`)
    }
    await convertMutex.acquire(signal)
    try {
      const inputs = dedupeInputPaths(parsed.data.inputPaths)
      emit({
        kind: 'progress',
        current: 0,
        total: inputs.length,
        stage: 'locate',
        message: '定位转换组件…'
      })

      const locate = await locateSoffice({
        customPath: await ctx.settings.get('customPath', ''),
        portableDir: portableProgramDir,
        queryRegistry: deps.queryRegistry,
        exists: deps.fileExists
      })
      if (locate.path === undefined) {
        throw toolError('SOFFICE_NOT_FOUND')
      }
      const command = pickSofficeCommand(locate.path)
      if (command === null) throw toolError('SPAWN_FAILED', locate.path)

      const taskDir = taskWorkDir(ctx.paths.temp, taskId, 'lumin-docx2pdf')
      try {
        const outputs: BatchOutput[] = []
        const failures: BatchFailure[] = []
        for (const [index, inputPath] of inputs.entries()) {
          if (signal.aborted) throw new Error('aborted')
          try {
            const outputPath = await convertOne({
              inputPath,
              command,
              workDir: join(taskDir, `f${index + 1}`),
              index,
              total: inputs.length,
              signal,
              emit
            })
            outputs.push({ inputPath, outputPath })
          } catch (err) {
            // 取消属于任务终态，直接上抛；单文件失败不中断批次（spec §3.1）
            if (signal.aborted) throw err
            failures.push(toBatchFailure(inputPath, err))
          }
        }

        // 全部失败：抛首个结构化错误，保持单文件语义与 [重试] 入口不变
        const firstFailure = failures[0]
        if (outputs.length === 0 && firstFailure !== undefined) throw firstFailure

        emit({
          kind: 'progress',
          current: inputs.length,
          total: inputs.length,
          stage: 'done',
          message: '完成'
        })
        return { outputs, failures } satisfies BatchConvertResult
      } finally {
        try {
          await deps.removeDir(taskDir)
        } catch (err) {
          ctx.log.warn('清理批量工作目录失败', taskDir, err)
        }
      }
    } finally {
      convertMutex.release()
    }
  })

  ctx.registerTask('install', async ({ payload, signal, emit }) => {
    if (!installPayloadSchema.safeParse(payload).success) {
      throw makeError('INVALID_PAYLOAD', '安装参数无效')
    }
    await installMutex.acquire(signal)
    try {
      if (signal.aborted) throw new Error('aborted')
      const installed = probeSofficeDir(portableProgramDir, deps.fileExists)
      if (installed !== null) return { path: installed }

      try {
        await deps.makeDir(installWorkDir)
      } catch (err) {
        throw toolError('INSTALL_FAILED', errnoCode(err) || String(err))
      }

      emit({ kind: 'progress', current: 0, stage: 'download', message: '下载组件…' })
      const msiPath = await deps.download({
        destDir: installWorkDir,
        signal,
        onProgress: (loaded, total) => {
          emit({
            kind: 'progress',
            current: loaded,
            total,
            stage: 'download',
            message: `${formatBytes(loaded)} / ${formatBytes(total)}`
          })
        }
      })
      if (signal.aborted) throw new Error('aborted')

      emit({ kind: 'progress', current: 0, stage: 'install', message: '安装组件…' })
      let result: RunProcessResult
      try {
        result = await deps.run({
          command: 'msiexec',
          args: [
            '/a',
            msiPath,
            '/qn',
            `TARGETDIR=${join(ctx.paths.userData, 'libreoffice-portable')}`
          ],
          timeoutMs: INSTALL_TIMEOUT_MS,
          signal
        })
      } catch (err) {
        if (err instanceof SpawnError) throw toolError('INSTALL_FAILED', spawnDetail(err))
        throw err
      }
      if (result.aborted || signal.aborted) throw new Error('aborted')
      if (result.timedOut) throw toolError('INSTALL_FAILED', `超时 ${INSTALL_TIMEOUT_MS / 1000} 秒`)
      if (result.code !== 0) {
        throw toolError('INSTALL_FAILED', tail(convertDetail(result.stderr, result.stdout)))
      }

      const after = probeSofficeDir(portableProgramDir, deps.fileExists)
      if (after === null) throw toolError('INSTALL_FAILED', '安装完成但未找到 soffice 入口')
      emit({ kind: 'progress', current: 1, stage: 'done', message: '完成' })
      return { path: after }
    } finally {
      installMutex.release()
    }
  })
}

/** 生产实现：node:fs + reg 查询 + 下载 + msiexec/soffice 进程（测试可作基底再覆盖） */
export function createNodeDeps(): Docx2pdfDeps {
  return {
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
    run: runProcess,
    download: downloadMsi,
    checkReadable: (path) => access(path, constants.R_OK),
    // 读方式打开探测共享冲突（独占句柄 share=None 会拒绝任何打开）；
    // 用 'r' 而非 'r+'：只读输入（只读属性/只读 ACL）不应被误判为「被占用」
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
    move: { rename, copyFile, unlink }
  }
}

export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
