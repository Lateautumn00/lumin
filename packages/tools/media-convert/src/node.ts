/**
 * @file media-convert 主进程逻辑（node-kit.runProcess + 壳任务队列三段式）
 * @author cuilanchao
 * @date 2026-11-19
 * @description probe（sync，ffmpeg 元信息）/ process（task，五模式批量串行 + 可取消）/
 *              config 与 set-output-dir（sync，输出目录记忆）；引擎复用 binaries/download/ffmpeg.exe，
 *              零新增依赖。批量语义：单文件失败不中断批次；取消 = AbortSignal 杀树，已完成文件保留。
 *              进度经 `-progress pipe:1` 解析并节流。deps 可注入便于单测
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { runProcess, tail, type RunProcessResult } from '@lumin/node-kit'
import { isStructuredError, makeError } from '@lumin/shared'
import type { MainPluginContext, RegisterMain, TaskHandlerContext } from '@lumin/plugin-api'
import {
  MAX_FILE_BYTES,
  configResultSchema,
  extensionOf,
  isAudioExtension,
  isVideoExtension,
  probePayloadSchema,
  probeResultSchema,
  processPayloadSchema,
  processResultSchema,
  setOutputDirPayloadSchema,
  trimRangeError,
  type ProcessFailure,
  type ProcessPayload,
  type ProcessResult,
  type ProbeFailure,
  type ProbeItem
} from './schema'
import { errnoCode, toolError } from './errors'
import { remuxError } from './compat'
import {
  buildAudioConvertArgs,
  buildCompressArgs,
  buildExtractAudioArgs,
  buildTranscodeArgs,
  buildTrimArgs,
  classifyFfmpegFailure
} from './encode'
import {
  CORRUPT_HINTS,
  formatClock,
  parseMediaInfo,
  parseProgressLine,
  shouldEmitProgress,
  type ParsedMediaInfo
} from './media'
import {
  buildAudioConvertName,
  buildCompressName,
  buildExtractAudioName,
  buildTranscodeName,
  buildTrimName,
  uniqueName
} from './naming'

/** 可注入依赖（单测传假件；image-toolbox/file-hasher 同口径） */
export interface MediaConvertDeps {
  /** 进程执行器（默认 node-kit runProcess，支持超时/abort 杀树/行回调） */
  runProcess: typeof runProcess
  /** 当前时间戳（毫秒），单测固定 */
  now: () => number
}

/** 默认依赖（真实 runProcess） */
function createDefaultDeps(): MediaConvertDeps {
  return {
    runProcess,
    now: () => Date.now()
  }
}

/** probe 单文件超时（spec §4：10s，超时杀树） */
export const PROBE_TIMEOUT_MS = 10_000

/** 单文件处理超时（spec §4：30 分钟） */
export const PROCESS_TIMEOUT_MS = 30 * 60 * 1000

/** 设置键：输出目录记忆（settings 命名空间由壳按工具 id 隔离） */
const SETTINGS_KEY = 'outputDir'

/**
 * 从子进程输出提取诊断尾行（detail 用；超时给专属文案）
 * @param result runProcess 终态结果
 */
function diagnose(result: RunProcessResult): string {
  return result.timedOut ? `超时（${PROBE_TIMEOUT_MS / 1000}s）` : tail(result.stderr.trim())
}

/**
 * 单文件元信息探测（probe 与 process 共用）：`ffmpeg -i` → 时长/音视频流
 * @param file 磁盘绝对路径
 * @param ffmpegPath ffmpeg 可执行文件路径
 * @param deps 可注入依赖
 */
async function probeMedia(
  file: string,
  ffmpegPath: string,
  deps: MediaConvertDeps
): Promise<ParsedMediaInfo> {
  // 无输出文件 → ffmpeg 以 code 1 退出并把流信息打到 stderr（不解码，探测开销最小）
  const result = await deps.runProcess({
    command: ffmpegPath,
    args: ['-hide_banner', '-i', file],
    timeoutMs: PROBE_TIMEOUT_MS,
    maxOutputChars: 256 * 1024
  })
  if (result.timedOut) throw toolError('MC_PROBE_FAILED', diagnose(result))
  if (result.aborted) throw toolError('MC_CANCELLED')
  const info = parseMediaInfo(result.stderr)
  if (info === null) {
    const corrupt =
      result.stderr.includes(': Video: ') ||
      result.stderr.includes(': Audio: ') ||
      CORRUPT_HINTS.test(result.stderr)
    throw toolError(corrupt ? 'MC_FILE_CORRUPT' : 'MC_PROBE_FAILED', diagnose(result))
  }
  if (info.video === null && info.audio === null) {
    throw toolError('MC_FILE_CORRUPT', diagnose(result))
  }
  return info
}

/**
 * 注册 media-convert 全部通道（工具注册入口，可注入 deps 供测试）
 * @param ctx 主进程插件上下文（paths/settings/log/registerIpc/registerTask）
 * @param deps 可注入依赖，默认真实 runProcess
 */
export function registerWith(ctx: MainPluginContext, deps: MediaConvertDeps): void {
  const engineDir = join(ctx.paths.binaries, 'download')
  const ffmpegPath = join(engineDir, 'ffmpeg.exe')
  const defaultOutputDir = join(ctx.paths.userData, 'media')

  /** 引擎预检：ffmpeg 存在即过（SHA 由 fetch 脚本负责） */
  const ensureEngine = (): ReturnType<typeof toolError> | null =>
    existsSync(ffmpegPath) ? null : toolError('MC_ENGINE_MISSING')

  // —— probe（sync）：选文件后即探测，列表实时展示时长/分辨率/大小（spec §4） ——
  ctx.registerIpc('probe', async ({ payload }) => {
    const parsed = probePayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    const engineError = ensureEngine()
    if (engineError !== null) throw engineError
    const items: ProbeItem[] = []
    const failures: ProbeFailure[] = []
    for (const file of parsed.data.files) {
      try {
        const stat = statSync(file)
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw toolError('MC_FILE_UNSUPPORTED')
        if (extensionOf(file) === null) throw toolError('MC_FILE_UNSUPPORTED')
        const info = await probeMedia(file, ffmpegPath, deps)
        items.push(
          probeResultSchema.shape.items.element.parse({
            file,
            durationSec: info.durationSec,
            sizeBytes: stat.size,
            video: info.video,
            audio: info.audio
          })
        )
      } catch (err) {
        if (!isStructuredError(err)) {
          failures.push({
            file,
            code: 'MC_FILE_UNSUPPORTED',
            message: '文件不可读（不存在或被占用）'
          })
        } else {
          failures.push({ file, code: err.code, message: err.message })
        }
      }
    }
    return probeResultSchema.parse({ items, failures })
  })

  // —— config（sync）：输出目录记忆回填（settings `outputDir`，spec §4） ——
  ctx.registerIpc('config', async () => {
    const saved = await ctx.settings.get<string | null>(SETTINGS_KEY, null)
    return configResultSchema.parse({ outputDir: saved ?? defaultOutputDir })
  })

  // —— set-output-dir（sync）：目录选择后即时记忆（spec §4） ——
  ctx.registerIpc('set-output-dir', async ({ payload }) => {
    const parsed = setOutputDirPayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    await ctx.settings.set(SETTINGS_KEY, parsed.data.outputDir)
  })

  // —— process（task）：四模式批量串行 + 可取消，done 返回逐文件结果（spec §4/§7） ——
  ctx.registerTask<ProcessPayload, ProcessResult>('process', async (taskCtx) => {
    try {
      return await runProcessTask(taskCtx, {
        ffmpegPath,
        deps,
        settings: ctx.settings
      })
    } catch (err) {
      if (isStructuredError(err)) throw err
      if (err instanceof Error) throw toolError('MC_FILE_CORRUPT', tail(err.message))
      throw err
    }
  })

  ctx.log.info('media-convert registered', { engineDir })
}

/** process 任务上下文所需的闭包资源（registerWith 组装，runProcessTask 消费） */
interface ProcessEnv {
  ffmpegPath: string
  deps: MediaConvertDeps
  settings: MainPluginContext['settings']
}

/**
 * 四模式 → 输出文件名候选（spec §6）
 * @param payload 已校验任务入参
 * @param inputName 输入文件名
 * @param startSec 截取开始秒（非截取模式忽略）
 * @param endSec 截取结束秒（非截取模式忽略）
 */
function outputNameOf(
  payload: ProcessPayload,
  inputName: string,
  startSec: number,
  endSec: number
): string {
  switch (payload.mode) {
    case 'transcode':
      return buildTranscodeName(inputName, payload.options.format, payload.options.mode)
    case 'trim':
      return buildTrimName(inputName, startSec, endSec)
    case 'extract-audio':
      return buildExtractAudioName(inputName, payload.options.format)
    case 'audio-convert':
      return buildAudioConvertName(inputName, payload.options.format)
    case 'compress':
      return buildCompressName(inputName, payload.options.level)
  }
}

/**
 * 四模式 → ffmpeg 完整参数（spec §5）
 * @param payload 已校验任务入参
 * @param input 输入路径
 * @param output 输出路径
 */
function buildArgsOf(payload: ProcessPayload, input: string, output: string): string[] {
  switch (payload.mode) {
    case 'transcode':
      return buildTranscodeArgs(payload.options, input, output)
    case 'trim':
      return buildTrimArgs(payload.options, input, output)
    case 'extract-audio':
      return buildExtractAudioArgs(payload.options, input, output)
    case 'audio-convert':
      return buildAudioConvertArgs(payload.options, input, output)
    case 'compress':
      return buildCompressArgs(payload.options, input, output)
  }
}

/**
 * 执行一次批量处理任务：参数/目录 precheck → 逐文件（探测/校验/命名/编码）→ 逐文件结果
 * @param taskCtx 任务上下文（payload 在外层 zod 校验）
 * @param env 闭包资源
 */
async function runProcessTask(
  taskCtx: TaskHandlerContext<ProcessPayload>,
  env: ProcessEnv
): Promise<ProcessResult> {
  const parsed = processPayloadSchema.safeParse(taskCtx.payload)
  if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
  if (!existsSync(env.ffmpegPath)) throw toolError('MC_ENGINE_MISSING')
  const input = parsed.data
  const outputDir = input.outputDir

  if (input.mode === 'trim') {
    const rangeError = trimRangeError(input.options)
    if (rangeError !== null) throw toolError('MC_PARAM_INVALID', rangeError)
  }

  // 输出目录 precheck：不存在则递归创建（失败 → MC_OUTPUT_WRITE_FAILED，errno 入 detail）
  try {
    mkdirSync(outputDir, { recursive: true })
  } catch (err) {
    throw toolError('MC_OUTPUT_WRITE_FAILED', errnoCode(err))
  }
  await env.settings.set(SETTINGS_KEY, outputDir)

  /** 已占用输出文件名（Windows 大小写不敏感：统一 lowercase 键，含同批次已分配名） */
  let existing: Set<string>
  try {
    existing = new Set(readdirSync(outputDir).map((name) => name.toLowerCase()))
  } catch (err) {
    throw toolError('MC_OUTPUT_WRITE_FAILED', errnoCode(err))
  }

  const outputs: ProcessResult['outputs'] = []
  const failures: ProcessFailure[] = []
  const total = input.files.length

  for (const [index, file] of input.files.entries()) {
    if (taskCtx.signal.aborted) break
    try {
      const output = await processOne(file, input, {
        outputDir,
        ffmpegPath: env.ffmpegPath,
        deps: env.deps,
        existing,
        signal: taskCtx.signal,
        onProgress: (percent, message) => {
          // 总进度 = (已完成文件数 + 当前文件百分比) / 总数（spec §4）
          const overall = Math.round(((index + percent / 100) / total) * 100)
          taskCtx.emit({
            kind: 'progress',
            current: overall,
            total: 100,
            stage: input.mode,
            message
          })
        }
      })
      outputs.push(output)
    } catch (err) {
      // 用户取消：不记失败项，直接跳出（已完成文件保留，队列统一终态 CANCELLED）
      if (isStructuredError(err) && err.code === 'MC_CANCELLED') break
      if (!isStructuredError(err)) {
        failures.push({
          input: file,
          code: 'MC_FILE_CORRUPT',
          message: tail(err instanceof Error ? err.message : '')
        })
      } else {
        failures.push({ input: file, code: err.code, message: err.message })
      }
    }
  }
  taskCtx.emit({ kind: 'progress', current: 100, total: 100, message: '' })
  return processResultSchema.parse({ outputs, failures })
}

/** processOne 所需资源（runProcessTask 组装） */
interface SingleEnv {
  outputDir: string
  ffmpegPath: string
  deps: MediaConvertDeps
  /** 已占用文件名集合（lowercase 键，分配后回写） */
  existing: Set<string>
  signal: AbortSignal
  /** 单文件进度回调（0–100，含展示文案） */
  onProgress: (percent: number, message: string) => void
}

/**
 * 处理单文件：校验 → 探测/流校验 → 命名 → ffmpeg 编码 → 结果统计
 * @param file 输入文件绝对路径
 * @param payload zod 校验后的任务入参（mode + options）
 * @param env 单文件处理资源
 */
async function processOne(
  file: string,
  payload: ProcessPayload,
  env: SingleEnv
): Promise<ProcessResult['outputs'][number]> {
  const inputExt = extensionOf(file)
  if (inputExt === null) throw toolError('MC_FILE_UNSUPPORTED')
  const stat = statSync(file)
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw toolError('MC_FILE_UNSUPPORTED')

  const info = await probeMedia(file, env.ffmpegPath, env.deps)

  // 流校验（spec §5）：视频目标要求视频轨 + 视频扩展名；提取音频要求音频轨；
  // 音频互转要求音频扩展名 + 音频轨（视频请走提取音频）
  if (payload.mode === 'extract-audio') {
    if (info.audio === null) throw toolError('MC_NO_STREAM')
  } else if (payload.mode === 'audio-convert') {
    if (!isAudioExtension(inputExt)) throw toolError('MC_FILE_UNSUPPORTED')
    if (info.audio === null) throw toolError('MC_NO_STREAM')
  } else {
    if (!isVideoExtension(inputExt)) throw toolError('MC_NO_STREAM')
    if (info.video === null) throw toolError('MC_NO_STREAM')
  }

  // remux 兼容预检：源编码须可直通目标容器，否则单文件失败（批次继续，spec §5.1）
  if (payload.mode === 'transcode' && payload.options.mode === 'remux') {
    const reason = remuxError(
      payload.options.format,
      info.video?.codec ?? null,
      info.audio?.codec ?? null
    )
    if (reason !== null) throw toolError('MC_CONTAINER_INCOMPATIBLE', reason)
  }

  const startSec = payload.mode === 'trim' ? payload.options.startSec : 0
  const endSec =
    payload.mode === 'trim'
      ? info.durationSec > 0
        ? Math.min(payload.options.endSec, info.durationSec)
        : payload.options.endSec
      : info.durationSec
  // endSec 已按源时长收敛且入参在批次入口校验过（endSec > startSec），此处只需检查起点越界
  if (payload.mode === 'trim' && info.durationSec > 0 && startSec >= info.durationSec) {
    throw toolError('MC_PARAM_INVALID', '开始时间超出源时长')
  }
  /** 本次输出的目标时长（进度与结果共用；源时长未知时退化为入参） */
  const outputDurationSec = Math.max(0, endSec - startSec)

  // 命名（spec §6）+ 同批次去重
  const candidate = outputNameOf(payload, basename(file), startSec, endSec)
  const name = uniqueName(env.existing, candidate)
  env.existing.add(name.toLowerCase())
  const output = join(env.outputDir, name)
  const args = buildArgsOf(payload, file, output)

  // 进度解析 + 节流（spec §4）
  let lastPercent: number | null = null
  let lastAt = 0
  const emitProgress = (processedSec: number, finished: boolean): void => {
    const percent =
      outputDurationSec > 0 ? Math.min(100, (processedSec / outputDurationSec) * 100) : 0
    if (!finished && !shouldEmitProgress(lastPercent, percent, env.deps.now(), lastAt)) {
      return
    }
    lastPercent = percent
    lastAt = env.deps.now()
    env.onProgress(
      percent,
      `${basename(file)} · ${formatClock(processedSec)}/${formatClock(outputDurationSec)}`
    )
  }
  emitProgress(0, false)

  const result = await env.deps.runProcess({
    command: env.ffmpegPath,
    args,
    signal: env.signal,
    timeoutMs: PROCESS_TIMEOUT_MS,
    maxOutputChars: 256 * 1024,
    onStdoutLine: (line) => {
      const value = parseProgressLine(line)
      if (value === null) return
      if (value.outTimeUs !== undefined) emitProgress(value.outTimeUs / 1_000_000, false)
      if (value.finished === true) emitProgress(outputDurationSec, true)
    }
  })
  if (result.aborted) throw toolError('MC_CANCELLED')
  if (result.timedOut) throw toolError('MC_TIMEOUT', diagnose(result))
  if (result.code !== 0) throw toolError(classifyFfmpegFailure(result.stderr), diagnose(result))

  const afterStat = statSync(output)
  return {
    input: file,
    output,
    durationSec: Math.round(outputDurationSec * 1000) / 1000,
    beforeBytes: stat.size,
    afterBytes: afterStat.size
  }
}

/** 生产注册入口（壳 tool-mains.ts 调用；测试用 registerWith 注入假 deps） */
export const registerMain: RegisterMain = (ctx) => registerWith(ctx, createDefaultDeps())
