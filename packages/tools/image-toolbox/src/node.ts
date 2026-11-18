/**
 * @file image-toolbox 主进程逻辑（node-kit.runProcess + 壳任务队列三段式）
 * @author cuilanchao
 * @date 2026-11-18
 * @description probe（sync，ffprobe 元信息）/ process（task，批量串行 + 可取消）/
 *              config（sync，输出目录记忆）通道注册；引擎复用 binaries/download/ffmpeg.exe
 *              + ffprobe.exe（M4 已拉取，零新增依赖）。批量语义：单张失败不中断批次
 *              （spec §7）；取消 = AbortSignal 杀树，已完成文件保留。deps 可注入便于单测
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
  probePayloadSchema,
  probeResultSchema,
  processPayloadSchema,
  processResultSchema,
  type ProcessFailure,
  type ProcessPayload,
  type ProcessResult,
  type ProbeFailure,
  type ProbeItem
} from './schema'
import { errnoCode, toolError } from './errors'
import {
  buildEncodeArgs,
  buildScaleArgs,
  classifyFfmpegFailure,
  resolveTargetSize,
  type ResizeParams
} from './encode'
import { buildOutputName, compressOutputExt, uniqueName, type SizeTag } from './naming'

/** 可注入依赖（单测传假件；docx2pdf/video-download node.ts 同口径） */
export interface ImageToolboxDeps {
  /** 进程执行器（默认 node-kit runProcess，支持超时/abort 杀树） */
  runProcess: typeof runProcess
  /** 当前时间戳（毫秒），单测固定 */
  now: () => number
}

/** 默认依赖（真实 runProcess） */
function createDefaultDeps(): ImageToolboxDeps {
  return {
    runProcess,
    now: () => Date.now()
  }
}

/** probe/单张尺寸探测超时（spec §4：单文件 ffprobe 10s，超时杀树） */
export const PROBE_TIMEOUT_MS = 10_000

/** ffprobe JSON 中判定动图的 codec（静态 webp 误标仅影响 -loop 0 与 UI 标签，无视觉差异） */
const ANIMATED_CODECS = new Set(['gif', 'webp', 'apng'])

/** ffprobe JSON 流形状（仅取用字段；宽松解析后经 zod 收口） */
interface ProbeStream {
  codec_name?: unknown
  codec_type?: unknown
  width?: unknown
  height?: unknown
}

/**
 * 从子进程输出提取诊断尾行（detail 用；超时给专属文案）
 * @param result runProcess 终态结果
 */
function diagnose(result: RunProcessResult): string {
  return result.timedOut ? `超时（${PROBE_TIMEOUT_MS / 1000}s）` : tail(result.stderr.trim())
}

/**
 * 单张图片元信息探测（probe 与 resize 共用）：ffprobe JSON → 首个视频流
 * @param file 磁盘绝对路径
 * @param ffprobePath ffprobe 可执行文件路径
 * @param deps 可注入依赖
 * @returns 宽高/编码器名（codec_name）/是否动图
 */
async function probeStream(
  file: string,
  ffprobePath: string,
  deps: ImageToolboxDeps
): Promise<{ width: number; height: number; codecName: string; animated: boolean }> {
  const result = await deps.runProcess({
    command: ffprobePath,
    args: ['-v', 'error', '-print_format', 'json', '-show_streams', file],
    timeoutMs: PROBE_TIMEOUT_MS
  })
  if (result.timedOut || result.code !== 0 || result.aborted) {
    throw toolError('IT_PROBE_FAILED', diagnose(result))
  }
  let json: { streams?: ProbeStream[] }
  try {
    json = JSON.parse(result.stdout) as { streams?: ProbeStream[] }
  } catch {
    throw toolError('IT_PROBE_FAILED', 'ffprobe 输出不是合法 JSON')
  }
  const stream = json.streams?.find((s) => s.codec_type === 'video')
  if (
    stream === undefined ||
    typeof stream.width !== 'number' ||
    typeof stream.height !== 'number' ||
    typeof stream.codec_name !== 'string' ||
    stream.width < 1 ||
    stream.height < 1
  ) {
    throw toolError('IT_FILE_CORRUPT', 'ffprobe 未返回有效视频流（可能非图片或已损坏）')
  }
  return {
    width: stream.width,
    height: stream.height,
    codecName: stream.codec_name,
    animated: ANIMATED_CODECS.has(stream.codec_name)
  }
}

/**
 * 注册 image-toolbox 全部通道（工具注册入口，可注入 deps 供测试）
 * @param ctx 主进程插件上下文（paths/settings/log/registerIpc/registerTask）
 * @param deps 可注入依赖，默认真实 runProcess
 */
export function registerWith(ctx: MainPluginContext, deps: ImageToolboxDeps): void {
  const engineDir = join(ctx.paths.binaries, 'download')
  const ffmpegPath = join(engineDir, 'ffmpeg.exe')
  const ffprobePath = join(engineDir, 'ffprobe.exe')
  const defaultOutputDir = join(ctx.paths.userData, 'images')

  /** 引擎预检：两个可执行文件存在即过（SHA 由 fetch 脚本负责） */
  const ensureEngine = (): ReturnType<typeof toolError> | null =>
    existsSync(ffmpegPath) && existsSync(ffprobePath) ? null : toolError('IT_ENGINE_MISSING')

  // —— probe（sync）：选文件后即探测，列表实时展示尺寸/大小（spec §4） ——
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
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw toolError('IT_FILE_UNSUPPORTED')
        if (extensionOf(file) === null) throw toolError('IT_FILE_UNSUPPORTED')
        const info = await probeStream(file, ffprobePath, deps)
        items.push(
          probeResultSchema.shape.items.element.parse({
            file,
            format: info.codecName,
            width: info.width,
            height: info.height,
            sizeBytes: stat.size,
            animated: info.animated
          })
        )
      } catch (err) {
        if (!isStructuredError(err)) {
          failures.push({
            file,
            code: 'IT_FILE_UNSUPPORTED',
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
    const saved = await ctx.settings.get<string | null>('outputDir', null)
    return configResultSchema.parse({ outputDir: saved ?? defaultOutputDir })
  })

  // —— process（task）：批量串行 + 可取消，done 返回逐文件结果（spec §4/§7） ——
  ctx.registerTask<ProcessPayload, ProcessResult>('process', async (taskCtx) => {
    try {
      return await runProcessTask(taskCtx, {
        ffmpegPath,
        ffprobePath,
        defaultOutputDir,
        deps,
        settings: ctx.settings
      })
    } catch (err) {
      // 兜底：非结构化异常包 IT_OUTPUT_WRITE_FAILED 之外的批次级错误原样透传
      if (isStructuredError(err)) throw err
      if (err instanceof Error) throw toolError('IT_FILE_CORRUPT', tail(err.message))
      throw err
    }
  })

  ctx.log.info('image-toolbox registered', { engineDir })
}

/** process 任务上下文所需的闭包资源（registerWith 组装，runProcessTask 消费） */
interface ProcessEnv {
  ffmpegPath: string
  ffprobePath: string
  /** outputDir 缺省回填根（壳注入 userData/images） */
  defaultOutputDir: string
  deps: ImageToolboxDeps
  settings: MainPluginContext['settings']
}

/**
 * 缩放参数（resizeOptions 去掉 format/quality/noUpscale）→ 纯函数入参
 * @param options zod 校验后的 resize options
 */
function resizeParamsOf(
  options: Extract<ProcessPayload, { mode: 'resize' }>['options']
): ResizeParams {
  if (options.mode === 'percent') return { mode: 'percent', percent: options.percent }
  if (options.mode === 'width') return { mode: 'width', width: options.width }
  if (options.mode === 'height') return { mode: 'height', height: options.height }
  return { mode: 'fit', fitWidth: options.fitWidth, fitHeight: options.fitHeight }
}

/**
 * 执行一次批量处理任务：目录 precheck → 逐文件（探测/命名/编码）→ 逐文件结果
 * @param taskCtx 任务上下文（payload 已由外层 zod 校验）
 * @param env 闭包资源
 */
async function runProcessTask(
  taskCtx: TaskHandlerContext<ProcessPayload>,
  env: ProcessEnv
): Promise<ProcessResult> {
  const parsed = processPayloadSchema.safeParse(taskCtx.payload)
  if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
  if (!existsSync(env.ffmpegPath) || !existsSync(env.ffprobePath)) {
    throw toolError('IT_ENGINE_MISSING')
  }
  const input = parsed.data
  const outputDir = input.outputDir

  // 输出目录 precheck：不存在则递归创建（失败 → IT_OUTPUT_WRITE_FAILED，errno 入 detail）
  try {
    mkdirSync(outputDir, { recursive: true })
  } catch (err) {
    throw toolError('IT_OUTPUT_WRITE_FAILED', errnoCode(err))
  }
  await env.settings.set('outputDir', outputDir)

  /** 已占用输出文件名（Windows 大小写不敏感：统一 lowercase 键，含同批次已分配名） */
  let existing: Set<string>
  try {
    existing = new Set(readdirSync(outputDir).map((name) => name.toLowerCase()))
  } catch (err) {
    throw toolError('IT_OUTPUT_WRITE_FAILED', errnoCode(err))
  }

  const outputs: ProcessResult['outputs'] = []
  const failures: ProcessFailure[] = []
  const total = input.files.length

  for (const [index, file] of input.files.entries()) {
    if (taskCtx.signal.aborted) break
    taskCtx.emit({
      kind: 'progress',
      current: index,
      total,
      message: basename(file)
    })
    try {
      const output = await processOne(file, input, {
        outputDir,
        ffmpegPath: env.ffmpegPath,
        ffprobePath: env.ffprobePath,
        deps: env.deps,
        existing,
        signal: taskCtx.signal
      })
      outputs.push(output)
    } catch (err) {
      // 用户取消：不记失败项，直接跳出（已完成文件保留，队列统一终态 CANCELLED）
      if (isStructuredError(err) && err.code === 'IT_CANCELLED') break
      if (!isStructuredError(err)) {
        failures.push({
          input: file,
          code: 'IT_FILE_CORRUPT',
          message: tail(err instanceof Error ? err.message : '')
        })
      } else {
        failures.push({ input: file, code: err.code, message: err.message })
      }
    }
  }
  taskCtx.emit({ kind: 'progress', current: total, total, message: '' })
  return processResultSchema.parse({ outputs, failures })
}

/** processOne 所需资源（runProcessTask 组装） */
interface SingleEnv {
  outputDir: string
  ffmpegPath: string
  ffprobePath: string
  deps: ImageToolboxDeps
  /** 已占用文件名集合（lowercase 键，分配后回写） */
  existing: Set<string>
  signal: AbortSignal
}

/**
 * 处理单张图片：校验 → 求扩展名/尺寸/命名 → ffmpeg 编码 → 结果统计
 * @param file 输入文件绝对路径
 * @param payload zod 校验后的任务入参（mode + options）
 * @param env 单张处理资源
 * @returns 输出条目（前后体积供压缩率展示）
 */
async function processOne(
  file: string,
  payload: ProcessPayload,
  env: SingleEnv
): Promise<ProcessResult['outputs'][number]> {
  const inputExt = extensionOf(file)
  if (inputExt === null) throw toolError('IT_FILE_UNSUPPORTED')
  const stat = statSync(file)
  if (stat.size > MAX_FILE_BYTES) throw toolError('IT_FILE_UNSUPPORTED')

  // 输出扩展名与质量（按模式分发，spec §2）
  let ext: ReturnType<typeof compressOutputExt>
  let quality: number
  let size: SizeTag | undefined
  let scaleArgs: string[] = []
  if (payload.mode === 'compress') {
    ext =
      payload.options.target === 'original' ? compressOutputExt(inputExt) : payload.options.target
    quality = payload.options.quality
  } else if (payload.mode === 'convert') {
    ext = payload.options.format
    quality = payload.options.quality
  } else {
    ext = payload.options.format
    quality = payload.options.quality
    // 缩放需原始尺寸：ffprobe 探测（损坏 → IT_PROBE_FAILED 归入单张失败）
    const info = await probeStream(file, env.ffprobePath, env.deps)
    const target = resolveTargetSize(
      { width: info.width, height: info.height },
      resizeParamsOf(payload.options),
      payload.options.noUpscale
    )
    // 命名尺寸段按入参模板恒定（spec §6）；「不放大」跳过缩放仅省略 -vf
    size =
      payload.options.mode === 'percent'
        ? { kind: 'percent', percent: payload.options.percent }
        : payload.options.mode === 'width'
          ? { kind: 'width', width: payload.options.width }
          : payload.options.mode === 'height'
            ? { kind: 'height', height: payload.options.height }
            : {
                kind: 'fit',
                fitWidth: payload.options.fitWidth,
                fitHeight: payload.options.fitHeight
              }
    scaleArgs = buildScaleArgs(target)
  }

  // 动图输入（gif/webp）：webp 输出保留动画，其余格式取首帧（spec §2.2）
  const animated = inputExt === 'gif' || inputExt === 'webp'
  const candidate = buildOutputName({
    inputName: basename(file),
    mode: payload.mode,
    quality,
    ...(size !== undefined ? { size } : {}),
    ext
  })
  const name = uniqueName(env.existing, candidate)
  env.existing.add(name.toLowerCase())
  const output = join(env.outputDir, name)

  const result = await env.deps.runProcess({
    command: env.ffmpegPath,
    args: [
      '-y',
      '-v',
      'error',
      '-i',
      file,
      ...scaleArgs,
      ...buildEncodeArgs({ format: ext, quality, animated }),
      output
    ],
    signal: env.signal,
    maxOutputChars: 256 * 1024
  })
  if (result.aborted) throw toolError('IT_CANCELLED')
  if (result.code !== 0) {
    throw toolError(classifyFfmpegFailure(result.stderr, output), diagnose(result))
  }
  const afterStat = statSync(output)
  return { input: file, output, beforeBytes: stat.size, afterBytes: afterStat.size }
}

/** 生产注册入口（壳 tool-mains.ts 调用；测试用 registerWith 注入假 deps） */
export const registerMain: RegisterMain = (ctx) => registerWith(ctx, createDefaultDeps())
