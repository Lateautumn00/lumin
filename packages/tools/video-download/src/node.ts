/**
 * @file video-download 主进程逻辑（node-kit.runProcess 流式行回调 + 壳任务队列三段式）
 * @author cuilanchao
 * @date 2026-11-19
 * @description probe（sync）/ start（task）/ mark-pause / history / cookie:*（list/set/remove/import-browser）
 *              通道注册；打开文件夹复用壳 `lumin:shell:reveal`；引擎 = binaries/download/yt-dlp.exe。
 *              Cookie 按 URL 域名匹配平台 → safeStorage 解密 → 临时 Netscape 文件透传 --cookies，终态删除（spec §9）。
 *              deps 可注入便于单测（docx2pdf node.ts 同口径）
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { runProcess, tail, type RunProcessResult } from '@lumin/node-kit'
import { isStructuredError, makeError } from '@lumin/shared'
import type { MainPluginContext, RegisterMain, TaskHandlerContext } from '@lumin/plugin-api'
import {
  cookieImportBrowserPayloadSchema,
  cookieListPayloadSchema,
  cookieListItemSchema,
  cookiePlatformSchema,
  cookieRemovePayloadSchema,
  cookieSetPayloadSchema,
  historyResultSchema,
  markPausePayloadSchema,
  probePayloadSchema,
  probeResultSchema,
  startPayloadSchema,
  historyClearPayloadSchema,
  type DownloadResult,
  type HistoryEntry,
  type ProbeResult,
  type StartPayload
} from './schema'
import { toolError, errnoCode } from './errors'
import { buildProbeArgs, buildStartArgs, parseProgressLine, progressMessage } from './progress'
import {
  buildCookieFileText,
  matchPlatformFor,
  parseCookieText,
  type CookiePlatform
} from './cookies'
import { importBrowserCookies, type BrowserCookieDeps } from './browser-cookies'
import { normalizeHistory, upsertHistory } from './history'

/** cookie:import-browser 入参（payload 形状，schema 推断） */
type CookieImportPayload = { platform: CookiePlatform; browser: 'firefox' | 'chromium-legacy' }

/** 可注入依赖（单测传假件） */
export interface VideoDownloadDeps {
  /** 进程执行器（默认 node-kit runProcess，支持流式行回调/超时/abort 杀树） */
  runProcess: typeof runProcess
  /** 当前时间戳（毫秒），单测固定 */
  now: () => number
  /** node:sqlite 可用性探测（浏览器 Cookie 读取用，Electron 主进程运行时决定） */
  hasSqlite: () => boolean
}

/** 默认依赖（真实 runProcess；reveal 走壳通道，此处无需 electron） */
function createDefaultDeps(): VideoDownloadDeps {
  let sqliteAvailable: boolean | null = null
  return {
    runProcess,
    now: () => Date.now(),
    hasSqlite: () => {
      if (sqliteAvailable === null) {
        try {
          void require.resolve('node:sqlite')
          sqliteAvailable = true
        } catch {
          sqliteAvailable = false
        }
      }
      return sqliteAvailable
    }
  }
}

/** probe 超时（spec §3：20s，超时杀树） */
export const PROBE_TIMEOUT_MS = 20_000

/** 进度阶段标记（renderer 据此展示阶段文案） */
const PROGRESS_STAGE = 'download'

/**
 * stderr/stdout 中判定平台不支持（yt-dlp 错误文案，spec §5 VD_UNSUPPORTED_PLATFORM）
 * @param text 合并后的子进程输出
 */
function isUnsupportedPlatform(text: string): boolean {
  return /unsupported\s+url/i.test(text)
}

/**
 * 从子进程输出提取 stderr 诊断尾行（detail 用；超时给专属文案）
 * @param result runProcess 终态结果
 */
function diagnose(result: RunProcessResult): string {
  return result.timedOut
    ? `超时（${PROBE_TIMEOUT_MS / 1000}s）`
    : tail(result.stderr.trim() || result.stdout.trim())
}

/**
 * 从进程终态回推最后进度字节数（尾搜 PROGRESS 行；abort 后流已停，取捕获缓存）。
 * yt-dlp 进度模板行走 stderr，after_move 等 --print 输出走 stdout，两端都搜。
 * @param result runProcess 终态结果
 */
function lastProgressBytes(result: RunProcessResult): number | undefined {
  for (const captured of [result.stderr, result.stdout]) {
    const lines = captured.split(/\r\n|\n|\r/)
    for (let i = lines.length - 1; i >= 0; i--) {
      const snapshot = parseProgressLine(lines[i] ?? '')
      if (snapshot !== null && snapshot.downloadedBytes !== null) return snapshot.downloadedBytes
    }
  }
  return undefined
}

/**
 * 注册 video-download 全部通道（工具注册入口，可注入 deps 供测试）
 * @param ctx 主进程插件上下文（paths/settings/log/registerIpc/registerTask）
 * @param deps 可注入依赖，默认真实 runProcess
 */
export function registerWith(ctx: MainPluginContext, deps: VideoDownloadDeps): void {
  const engineDir = join(ctx.paths.binaries, 'download')
  const enginePath = join(engineDir, 'yt-dlp.exe')
  const historyKey = 'history'
  const pausePending = new Set<string>()

  /** 引擎预检：yt-dlp.exe 存在即过（SHA 校验由 fetch 脚本负责，运行时只判缺失） */
  const ensureEngine = (): ReturnType<typeof toolError> | null =>
    existsSync(enginePath) ? null : toolError('VD_ENGINE_MISSING')

  /** 读历史（坏条目丢弃 + RUNNING→FAILED 归一，history.ts 纯函数） */
  const readHistory = async (): Promise<HistoryEntry[]> =>
    normalizeHistory(await ctx.settings.get<unknown[]>(historyKey, []))

  /** 写历史（条目置顶 + 滚动 100 条） */
  const writeEntry = async (entry: HistoryEntry): Promise<void> => {
    await ctx.settings.set(historyKey, upsertHistory(await readHistory(), entry))
  }

  // —— Cookie 加密存储（spec §9.1；settings 键 cookies.<platform>，密文 base64，永不落明文） ——

  interface CookieStoreEntry {
    cipher: string
    cookieCount: number
    updatedAt: number
  }

  /**
   * 确保壳注入了安全存储且可用（spec §9.1：不可用禁用功能，禁止降级明文）；
   * 返回收窄后的引用（TS 跨闭包不追踪 ctx.secure 收窄）
   */
  const requireSecure = (): NonNullable<MainPluginContext['secure']> => {
    const secure = ctx.secure
    if (secure === undefined || !secure.isEncryptionAvailable()) {
      throw toolError('VD_COOKIE_STORE_UNAVAILABLE')
    }
    return secure
  }

  /** 读某平台存储条目（无 → null） */
  const readCookieStore = async (platform: CookiePlatform): Promise<CookieStoreEntry | null> => {
    const raw = await ctx.settings.get<unknown>(`cookies.${platform}`, null)
    if (raw === null || typeof raw !== 'object') return null
    const candidate = raw as Partial<CookieStoreEntry>
    if (typeof candidate.cipher !== 'string' || typeof candidate.cookieCount !== 'number')
      return null
    return {
      cipher: candidate.cipher,
      cookieCount: candidate.cookieCount,
      updatedAt: candidate.updatedAt ?? 0
    }
  }

  /**
   * 取出某平台已存 cookie 的明文（解密）；未配置 → null
   * @param platform 平台
   */
  const loadCookiePlain = async (platform: CookiePlatform): Promise<string | null> => {
    const stored = await readCookieStore(platform)
    if (stored === null) return null
    return requireSecure().decryptString(stored.cipher)
  }

  /**
   * 按 URL 解析出临时 cookie 文件路径（spec §9.4）：域名匹配平台 → 解密 → 重析 Netscape 行 → 写 temp
   * @param url 视频链接
   * @param token 文件名去重 token（taskId / probe 随机串）
   * @returns 文件路径；平台未匹配或该平台未配置 cookie → null
   */
  const resolveCookieFile = async (url: string, token: string): Promise<string | null> => {
    const platform = matchPlatformFor(url)
    if (platform === null) return null
    const plain = await loadCookiePlain(platform)
    if (plain === null) return null
    const { lines } = parseCookieText(plain, platform)
    if (lines.length === 0) return null
    const file = join(ctx.paths.temp, `vd-cookie-${token}.txt`)
    try {
      mkdirSync(ctx.paths.temp, { recursive: true })
      writeFileSync(file, buildCookieFileText(lines), 'utf8')
    } catch (err) {
      throw toolError('VD_OUTPUT_WRITE_FAILED', errnoCode(err))
    }
    return file
  }

  /** 删除临时 cookie 文件（best-effort，任务终态清理） */
  const removeCookieFile = (file: string | null): void => {
    if (file === null) return
    try {
      unlinkSync(file)
    } catch {
      // 清理失败不影响主流程（temp 系统回收）
    }
  }

  /** 浏览器读取的运行时依赖（PowerShell 走 runProcess；temp 取 ctx.paths.temp） */
  const browserDeps: BrowserCookieDeps = {
    runProcess: (cmd, args, opts) =>
      deps
        .runProcess({ command: cmd, args, timeoutMs: opts?.timeoutMs })
        .then((r) => ({ stdout: r.stdout })),
    tempDir: ctx.paths.temp,
    hasSqlite: () => deps.hasSqlite()
  }

  // —— probe（sync）：yt-dlp -J 单 JSON，20s 超时；平台已配 cookie 时经临时文件透传 ——
  ctx.registerIpc('probe', async ({ payload }) => {
    const parsed = probePayloadSchema.safeParse(payload)
    if (!parsed.success) throw toolError('VD_URL_INVALID')
    const engineError = ensureEngine()
    if (engineError !== null) throw engineError
    let cookieFile: string | null = null
    try {
      cookieFile = await resolveCookieFile(parsed.data.url, `probe-${deps.now()}`)
      const result = await deps.runProcess({
        command: enginePath,
        args: buildProbeArgs(parsed.data.url, cookieFile ?? undefined),
        timeoutMs: PROBE_TIMEOUT_MS
      })
      if (result.timedOut || result.code !== 0 || result.aborted) {
        throw isUnsupportedPlatform(result.stderr + result.stdout)
          ? toolError('VD_UNSUPPORTED_PLATFORM')
          : toolError('VD_PROBE_FAILED', diagnose(result))
      }
      let json: Record<string, unknown>
      try {
        json = JSON.parse(result.stdout) as Record<string, unknown>
      } catch {
        throw toolError('VD_PROBE_FAILED', '输出不是合法 JSON')
      }
      const info = probeResultSchema.safeParse({
        title: json.title,
        platform: json.webpage_url_domain ?? json.extractor_key,
        durationSec: json.duration,
        thumbnailUrl: json.thumbnail
      })
      if (!info.success) throw toolError('VD_PROBE_FAILED', '元数据字段缺失')
      return info.data satisfies ProbeResult
    } finally {
      removeCookieFile(cookieFile)
    }
  })

  // —— mark-pause（sync）：暂停意图登记，通用 cancel 触发 abort 后据此区分 PAUSED/CANCELLED ——
  ctx.registerIpc('mark-pause', async ({ payload }) => {
    const parsed = markPausePayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    pausePending.add(parsed.data.taskId)
    return {}
  })

  // —— start（task）：三段式长任务，progress-template 逐行推送进度 ——
  ctx.registerTask<StartPayload, DownloadResult>('start', async (taskCtx) => {
    try {
      await runStart(taskCtx, {
        engineDir,
        enginePath,
        writeEntry,
        defaultOutputDir: join(ctx.paths.userData, 'downloads'),
        pausePending,
        deps,
        resolveCookieFile,
        removeCookieFile
      })
      // 占位返回：队列对 abort 的 handler 统一终态 CANCELLED（task-queue 兜底）
      return { outputPath: '' }
    } catch (err) {
      // 兜底：非结构化异常包 VD_DOWNLOAD_FAILED；结构化错误原样透传
      if (isStructuredError(err)) throw err
      if (err instanceof Error) throw toolError('VD_DOWNLOAD_FAILED', tail(err.message))
      throw err
    }
  })

  // —— history（sync）：读历史 ——
  ctx.registerIpc('history', async ({ payload }) => {
    historyClearPayloadSchema.safeParse(payload)
    return historyResultSchema.parse({ entries: await readHistory() })
  })

  // —— history:clear（sync）：清空历史 ——
  ctx.registerIpc('history:clear', async () => {
    await ctx.settings.set(historyKey, [])
    return {}
  })

  // —— cookie:list（sync）：三平台脱敏条目（spec §9.2：仅条数与时间，不含任何 cookie 内容） ——
  ctx.registerIpc('cookie:list', async ({ payload }) => {
    cookieListPayloadSchema.safeParse(payload)
    const items = []
    for (const platform of cookiePlatformSchema.options) {
      const stored = await readCookieStore(platform)
      items.push(
        cookieListItemSchema.parse({
          platform,
          cookieCount: stored?.cookieCount ?? 0,
          ...(stored !== null && stored.updatedAt > 0 ? { updatedAt: stored.updatedAt } : {})
        })
      )
    }
    return { items }
  })

  // —— cookie:set（sync）：粘贴文本 → 解析 → 加密落存储（spec §9.1） ——
  ctx.registerIpc('cookie:set', async ({ payload }) => {
    const parsed = cookieSetPayloadSchema.safeParse(payload)
    if (!parsed.success) throw toolError('VD_COOKIE_FORMAT_INVALID')
    requireSecure()
    const { platform, raw } = parsed.data
    const { lines, dropped } = parseCookieText(raw, platform)
    if (lines.length === 0) throw toolError('VD_COOKIE_FORMAT_INVALID', `丢弃 ${dropped} 行`)
    const secure = requireSecure()
    const updatedAt = deps.now()
    await ctx.settings.set(`cookies.${platform}`, {
      cipher: secure.encryptString(raw),
      cookieCount: lines.length,
      updatedAt
    })
    return { cookieCount: lines.length, dropped }
  })

  // —— cookie:remove（sync）：删除某平台 cookie ——
  ctx.registerIpc('cookie:remove', async ({ payload }) => {
    const parsed = cookieRemovePayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    await ctx.settings.set(`cookies.${parsed.data.platform}`, null)
    return {}
  })

  // —— cookie:import-browser（task）：只读浏览器库 → 解密 → 解析 → 加密落存储（spec §9.3） ——
  ctx.registerTask<CookieImportPayload, { cookieCount: number }>(
    'cookie:import-browser',
    async (taskCtx) => {
      const parsed = cookieImportBrowserPayloadSchema.safeParse(taskCtx.payload)
      if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
      const secure = requireSecure()
      const { platform, browser } = parsed.data
      try {
        taskCtx.emit({ kind: 'progress', current: 0, total: 3, stage: 'import' })
        const lines = await importBrowserCookies(platform, browser, browserDeps)
        taskCtx.emit({ kind: 'progress', current: 2, total: 3, stage: 'import' })
        await ctx.settings.set(`cookies.${platform}`, {
          cipher: secure.encryptString(buildCookieFileText(lines)),
          cookieCount: lines.length,
          updatedAt: deps.now()
        })
        taskCtx.emit({ kind: 'progress', current: 3, total: 3, stage: 'import' })
        ctx.log.info('cookie import ok', { platform, browser, cookieCount: lines.length })
        return { cookieCount: lines.length }
      } catch (err) {
        // 非结构化异常（浏览器缺失/解密失败等）包 VD_COOKIE_IMPORT_FAILED；结构化原样透传
        if (isStructuredError(err)) throw err
        if (err instanceof Error) throw toolError('VD_COOKIE_IMPORT_FAILED', tail(err.message))
        throw err
      }
    }
  )

  ctx.log.info('video-download registered', { engineDir })
}

/** 生产注册入口（壳 tool-mains.ts 调用；测试用 registerWith 注入假 deps） */
export const registerMain: RegisterMain = (ctx) => registerWith(ctx, createDefaultDeps())

/** start 任务上下文所需的闭包资源（registerWith 组装，runStart 消费） */
interface StartEnv {
  engineDir: string
  enginePath: string
  /** 写历史（registerWith 闭包：读旧历史 → upsert 置顶 → settings 持久化） */
  writeEntry: (entry: HistoryEntry) => Promise<void>
  /** outputDir 缺省时的落盘根（壳注入 userData/downloads） */
  defaultOutputDir: string
  pausePending: Set<string>
  deps: VideoDownloadDeps
  /** Cookie 透传：按 URL 匹配平台并解密落临时文件（无 → null，spec §9.4） */
  resolveCookieFile: (url: string, token: string) => Promise<string | null>
  /** 临时 cookie 文件清理（best-effort） */
  removeCookieFile: (file: string | null) => void
}

/**
 * 执行一次下载任务：目录 precheck → 历史 RUNNING → spawn（流式进度）→ 终态历史
 * @param taskCtx 任务上下文（payload 已由外层 zod 校验）
 * @param env 闭包资源
 */
async function runStart(taskCtx: TaskHandlerContext<StartPayload>, env: StartEnv): Promise<void> {
  const parsed = startPayloadSchema.safeParse(taskCtx.payload)
  if (!parsed.success) throw toolError('VD_URL_INVALID')
  if (!existsSync(env.enginePath)) throw toolError('VD_ENGINE_MISSING')
  const input = parsed.data
  const outputDir = input.outputDir ?? env.defaultOutputDir
  const taskId = taskCtx.taskId
  const startedAt = env.deps.now()

  // 输出目录 precheck：不存在则递归创建（失败 → VD_OUTPUT_WRITE_FAILED，errno 入 detail）
  try {
    mkdirSync(outputDir, { recursive: true })
  } catch (err) {
    throw toolError('VD_OUTPUT_WRITE_FAILED', errnoCode(err))
  }

  await env.writeEntry({
    id: taskId,
    url: input.url,
    title: '',
    preset: input.preset,
    outputDir,
    status: 'RUNNING',
    startedAt
  })

  let lastOutputPath = ''
  /**
   * 进度/路径行统一处理：PROGRESS 前缀 → 进度事件；其余非空行若为已存在文件路径
   * → 记为最终输出路径（--print after_move:filepath 的裸路径行）。
   * yt-dlp 的进度模板行走 stderr，--print 输出走 stdout，两端都挂同一处理。
   */
  const handleLine = (line: string): void => {
    const snapshot = parseProgressLine(line)
    if (snapshot !== null) {
      taskCtx.emit({
        kind: 'progress',
        current: snapshot.downloadedBytes ?? 0,
        total: snapshot.totalBytes ?? undefined,
        message: progressMessage(snapshot),
        stage: PROGRESS_STAGE
      })
      return
    }
    const trimmed = line.trim()
    if (trimmed !== '' && existsSync(trimmed)) lastOutputPath = trimmed
  }
  // Cookie 透传（spec §9.4）：平台匹配 + 已配置 → 临时 Netscape 文件；终态 finally 删除
  let cookieFile: string | null = null
  try {
    cookieFile = await env.resolveCookieFile(input.url, taskId)
    const result = await env.deps.runProcess({
      command: env.enginePath,
      args: buildStartArgs({
        url: input.url,
        preset: input.preset,
        outputDir,
        engineDir: env.engineDir,
        ...(cookieFile !== null ? { cookieFile } : {})
      }),
      signal: taskCtx.signal,
      // 长任务不限时（用户可取消/暂停）；进度行数多，捕获上限放宽到 1MB
      maxOutputChars: 1024 * 1024,
      onStdoutLine: handleLine,
      // 真实引擎进度行走 stderr（PowerShell 重定向实测验证，见 docs/smoke/video-download.md）
      onStderrLine: handleLine
    })

    const wasPause = env.pausePending.delete(taskId)
    const endedAt = env.deps.now()
    const finalBytes = lastProgressBytes(result)
    const baseEntry: Omit<HistoryEntry, 'status'> = {
      id: taskId,
      url: input.url,
      title: '',
      preset: input.preset,
      outputDir,
      startedAt,
      endedAt,
      ...(finalBytes !== undefined ? { downloadedBytes: finalBytes } : {})
    }

    if (result.aborted) {
      // 暂停（.part 保留可续传）与取消共用 abort；历史状态按意图区分
      await env.writeEntry({ ...baseEntry, status: wasPause ? 'PAUSED' : 'CANCELLED' })
      return
    }
    if (result.code !== 0) {
      await env.writeEntry({ ...baseEntry, status: 'FAILED' })
      throw isUnsupportedPlatform(result.stderr)
        ? toolError('VD_UNSUPPORTED_PLATFORM')
        : toolError('VD_DOWNLOAD_FAILED', diagnose(result))
    }
    await env.writeEntry({
      ...baseEntry,
      status: 'DONE',
      ...(lastOutputPath !== '' ? { outputName: basename(lastOutputPath) } : {})
    })
    taskCtx.emit({ kind: 'progress', current: 1, total: 1, stage: 'finish' })
  } finally {
    env.removeCookieFile(cookieFile)
  }
}
