/**
 * @file image-toolbox 主进程逻辑（node-kit.runProcess + 壳任务队列三段式）
 * @author cuilanchao
 * @date 2026-11-19
 * @description probe（sync，ffmpeg 元信息）/ process（task，批量串行 + 可取消）/
 *              make-gif（task，M40：逐帧探测 → 画布规划 → 单进程 filter_complex）/
 *              config（sync，输出目录记忆）通道注册；引擎只复用 binaries/download/ffmpeg.exe
 *              （M4 已拉取，零新增依赖；2026-11-19 体积优化移除 ffprobe 依赖，改解析
 *              `ffmpeg -i` 的 stderr 流信息）。批量语义：单张失败不中断批次（spec §7）；
 *              取消 = AbortSignal 杀树，已完成文件保留。deps 可注入便于单测
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { runProcess, tail, type RunProcessResult } from '@lumin/node-kit'
import { isStructuredError, makeError } from '@lumin/shared'
import type { MainPluginContext, RegisterMain, TaskHandlerContext } from '@lumin/plugin-api'
import {
  MAX_FILE_BYTES,
  appendHistoryPayloadSchema,
  collectFolderPayloadSchema,
  collectFolderResultSchema,
  configResultSchema,
  extensionOf,
  gifResultSchema,
  historyResultSchema,
  makeGifPayloadSchema,
  probePayloadSchema,
  probeResultSchema,
  processPayloadSchema,
  processResultSchema,
  setOutputDirPayloadSchema,
  type MakeGifPayload,
  type MakeGifResult,
  type ProcessFailure,
  type ProcessPayload,
  type ProcessResult,
  type ProbeFailure,
  type ProbeItem
} from './schema'
import { errnoCode, toolError } from './errors'
import { appendHistory, parseHistory } from './history'
import { collectImages } from './folder'
import {
  buildEncodeArgs,
  buildEffectFilter,
  buildScaleArgs,
  classifyFfmpegFailure,
  resolveTargetSize,
  type ResizeParams
} from './encode'
import {
  buildGifFilterGraph,
  fpsFromFrameMs,
  gifLoopArg,
  gifOutputName,
  planGifCanvas
} from './gif'
import { buildOutputName, compressOutputExt, uniqueName, type SizeTag } from './naming'
import {
  buildFilterArgs as buildRotateFilterArgs,
  buildRotateEncodeArgs,
  buildRotateOutputName
} from './rotate'
import { buildCropEncodeArgs, buildCropFilterArgs, buildCropOutputName } from './crop'
import {
  createNodeDeps as createWatermarkDeps,
  registerWith as registerWatermarkWith
} from './watermark/node'
import {
  createNodeDeps as createDewatermarkDeps,
  registerWith as registerDewatermarkWith
} from './dewatermark/node'
import {
  createNodeDeps as createStitchDeps,
  registerWith as registerStitchWith
} from './stitch/node'

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

/** probe/单张尺寸探测超时（spec §4：单文件探测 10s，超时杀树） */
export const PROBE_TIMEOUT_MS = 10_000

/** 判定动图的 codec（与引擎无关的既有口径：静态 webp 误标仅影响 UI 标签，无视觉差异） */
const ANIMATED_CODECS = new Set(['gif', 'webp', 'apng'])

/** 损坏类 stderr 特征（据此把「无可用视频流」细分为文件损坏而非探测失败） */
const CORRUPT_HINTS =
  /Invalid data|moov atom not found|does not contain any stream|End of file|No .* data found|Could not find codec parameters/i

/**
 * 解析 `ffmpeg -i <file>` stderr 中的首个视频流（纯函数，替代 ffprobe 以减小安装包体积）
 * @param stderr ffmpeg 探测输出（含 `Stream #0:0...: Video: <codec>, ..., <W>x<H>` 行）
 * @returns codec 名与宽高；无视频流 → null
 */
export function parseFfmpegStream(
  stderr: string
): { codecName: string; width: number; height: number } | null {
  for (const line of stderr.split(/\r?\n/)) {
    const marker = ': Video: '
    const idx = line.indexOf(marker)
    if (idx === -1) continue
    // 只解析 Video 段之后的内容，避免把 `#0:0[0x1]` 之类的流序号误当尺寸
    const rest = line.slice(idx + marker.length)
    const codecMatch = /^([^\s,]+)/.exec(rest)
    const sizeMatch = /(\d+)x(\d+)/.exec(rest)
    if (codecMatch === null || sizeMatch === null) continue
    const width = Number(sizeMatch[1])
    const height = Number(sizeMatch[2])
    if (width < 1 || height < 1) continue
    const codecName = codecMatch[1]
    if (codecName === undefined) continue
    return { codecName, width, height }
  }
  return null
}

/**
 * 从子进程输出提取诊断尾行（detail 用；超时给专属文案）
 * @param result runProcess 终态结果
 */
function diagnose(result: RunProcessResult): string {
  return result.timedOut ? `超时（${PROBE_TIMEOUT_MS / 1000}s）` : tail(result.stderr.trim())
}

/**
 * 单张图片元信息探测（probe 与 resize 共用）：`ffmpeg -i` → 首个视频流
 * @param file 磁盘绝对路径
 * @param ffmpegPath ffmpeg 可执行文件路径
 * @param deps 可注入依赖
 * @returns 宽高/编码器名（codec_name）/是否动图
 */
async function probeStream(
  file: string,
  ffmpegPath: string,
  deps: ImageToolboxDeps
): Promise<{ width: number; height: number; codecName: string; animated: boolean }> {
  // 无输出文件 → ffmpeg 以 code 1 退出并把流信息打到 stderr（不解码，探测开销最小）
  const result = await deps.runProcess({
    command: ffmpegPath,
    args: ['-hide_banner', '-i', file],
    timeoutMs: PROBE_TIMEOUT_MS
  })
  if (result.timedOut || result.aborted) {
    throw toolError('IT_PROBE_FAILED', diagnose(result))
  }
  const stream = parseFfmpegStream(result.stderr)
  if (stream === null) {
    // 有视频流行但取不到尺寸（实测损坏 jpg：`Video: mjpeg, none(...), 25 fps` 无 WxH）也算损坏
    const corrupt = result.stderr.includes(': Video: ') || CORRUPT_HINTS.test(result.stderr)
    throw toolError(corrupt ? 'IT_FILE_CORRUPT' : 'IT_PROBE_FAILED', diagnose(result))
  }
  return {
    width: stream.width,
    height: stream.height,
    codecName: stream.codecName,
    animated: ANIMATED_CODECS.has(stream.codecName)
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
  const defaultOutputDir = join(ctx.paths.userData, 'images')

  /** 引擎预检：ffmpeg 存在即过（SHA 由 fetch 脚本负责） */
  const ensureEngine = (): ReturnType<typeof toolError> | null =>
    existsSync(ffmpegPath) ? null : toolError('IT_ENGINE_MISSING')

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
        const info = await probeStream(file, ffmpegPath, deps)
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

  // —— config（sync）：输出目录与处理历史记忆回填（M63 追加 history） ——
  ctx.registerIpc('config', async () => {
    const saved = await ctx.settings.get<string | null>('outputDir', null)
    const rawHistory = await ctx.settings.get<unknown>('history', [])
    return configResultSchema.parse({
      outputDir: saved ?? defaultOutputDir,
      history: parseHistory(rawHistory)
    })
  })

  // —— collect-folder（sync，M63）：递归收集支持图片（白名单 + 2000 上限） ——
  ctx.registerIpc('collect-folder', async ({ payload }) => {
    const parsed = collectFolderPayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    let collected
    try {
      collected = await collectImages(parsed.data.dir)
    } catch (err) {
      throw toolError('IT_FOLDER_EMPTY', errnoCode(err))
    }
    if (collected.files.length === 0) throw toolError('IT_FOLDER_EMPTY')
    return collectFolderResultSchema.parse(collected)
  })

  // —— append-history（sync，M63）：完成一次处理后写入最近 20 条 ——
  ctx.registerIpc('append-history', async ({ payload }) => {
    const parsed = appendHistoryPayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    const current = parseHistory(await ctx.settings.get<unknown>('history', []))
    const next = appendHistory(current, { ...parsed.data, at: deps.now() })
    await ctx.settings.set('history', next)
    return historyResultSchema.parse({ history: next })
  })

  // —— clear-history（sync，M63） ——
  ctx.registerIpc('clear-history', async () => {
    await ctx.settings.set('history', [])
    return historyResultSchema.parse({ history: [] })
  })

  // —— set-output-dir（sync）：目录选择后即时记忆（spec §4） ——
  ctx.registerIpc('set-output-dir', async ({ payload }) => {
    const parsed = setOutputDirPayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    await ctx.settings.set('outputDir', parsed.data.outputDir)
  })

  // —— process（task）：批量串行 + 可取消，done 返回逐文件结果（spec §4/§7） ——
  ctx.registerTask<ProcessPayload, ProcessResult>('process', async (taskCtx) => {
    try {
      return await runProcessTask(taskCtx, {
        ffmpegPath,
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

  // —— make-gif（task，M40）：逐张探尺寸 → 画布规划 → 单进程 filter_complex 出片 ——
  ctx.registerTask<MakeGifPayload, MakeGifResult>('make-gif', async (taskCtx) => {
    try {
      return await runMakeGifTask(taskCtx, { ffmpegPath, deps, settings: ctx.settings })
    } catch (err) {
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
  if (!existsSync(env.ffmpegPath)) {
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

/** make-gif 任务所需的闭包资源 */
interface GifEnv {
  ffmpegPath: string
  deps: ImageToolboxDeps
  settings: MainPluginContext['settings']
}

/**
 * 执行 GIF 生成任务（M40，spec §2.5）：逐帧预检/探测 → 画布规划 → 单进程编码
 * @param taskCtx 任务上下文（payload 已由外层 zod 校验）
 * @param env 闭包资源
 */
async function runMakeGifTask(
  taskCtx: TaskHandlerContext<MakeGifPayload>,
  env: GifEnv
): Promise<MakeGifResult> {
  const parsed = makeGifPayloadSchema.safeParse(taskCtx.payload)
  if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
  if (!existsSync(env.ffmpegPath)) throw toolError('IT_ENGINE_MISSING')
  const input = parsed.data
  const outputDir = input.outputDir

  try {
    mkdirSync(outputDir, { recursive: true })
  } catch (err) {
    throw toolError('IT_OUTPUT_WRITE_FAILED', errnoCode(err))
  }
  await env.settings.set('outputDir', outputDir)

  let existing: Set<string>
  try {
    existing = new Set(readdirSync(outputDir).map((name) => name.toLowerCase()))
  } catch (err) {
    throw toolError('IT_OUTPUT_WRITE_FAILED', errnoCode(err))
  }

  // 逐帧预检 + 探测尺寸（进度「读取 i/n」，spec §2.5）
  const total = input.files.length
  const sizes: { width: number; height: number }[] = []
  for (const [index, file] of input.files.entries()) {
    if (taskCtx.signal.aborted) throw toolError('IT_CANCELLED')
    if (extensionOf(file) === null) throw toolError('IT_FILE_UNSUPPORTED')
    let size: number
    try {
      const stat = statSync(file)
      if (!stat.isFile()) throw toolError('IT_FILE_UNSUPPORTED')
      size = stat.size
    } catch (err) {
      if (isStructuredError(err)) throw err
      throw toolError('IT_FILE_UNSUPPORTED', errnoCode(err))
    }
    if (size > MAX_FILE_BYTES) throw toolError('IT_FILE_UNSUPPORTED')
    const info = await probeStream(file, env.ffmpegPath, env.deps)
    sizes.push({ width: info.width, height: info.height })
    taskCtx.emit({ kind: 'progress', current: index + 1, total, message: basename(file) })
  }

  const canvas = planGifCanvas(sizes, input.options.width)
  if (canvas === null) throw toolError('IT_GIF_TOO_LARGE')

  const fps = fpsFromFrameMs(input.options.durationMs)
  const args = ['-y', '-v', 'error']
  for (const file of input.files) args.push('-framerate', String(fps), '-i', file)
  args.push(
    '-filter_complex',
    buildGifFilterGraph(total, canvas),
    '-loop',
    gifLoopArg(input.options.loop)
  )

  const name = uniqueName(existing, gifOutputName(new Date(env.deps.now())))
  existing.add(name.toLowerCase())
  const output = join(outputDir, name)
  args.push(output)
  taskCtx.emit({ kind: 'progress', current: total, total, message: '编码 GIF' })

  const result = await env.deps.runProcess({
    command: env.ffmpegPath,
    args,
    signal: taskCtx.signal,
    maxOutputChars: 256 * 1024
  })
  if (result.aborted) throw toolError('IT_CANCELLED')
  if (result.code !== 0) {
    throw toolError(classifyFfmpegFailure(result.stderr, output), diagnose(result))
  }
  let sizeBytes: number
  try {
    sizeBytes = statSync(output).size
  } catch (err) {
    throw toolError('IT_OUTPUT_WRITE_FAILED', errnoCode(err))
  }
  return gifResultSchema.parse({
    outputPath: output,
    width: canvas.width,
    height: canvas.height,
    frames: total,
    sizeBytes
  })
}

/** processOne 所需资源（runProcessTask 组装） */
interface SingleEnv {
  outputDir: string
  ffmpegPath: string
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

  // 动图输入（gif/webp）：webp 输出保留动画，其余格式取首帧（spec §2.2）
  const animated = inputExt === 'gif' || inputExt === 'webp'

  // 旋转/裁剪（M70 §4.48）：静态变换，输出扩展名沿用压缩「保持原格式」映射（spec §2.6/§2.7）
  if (payload.mode === 'rotate' || payload.mode === 'crop') {
    const ext = compressOutputExt(inputExt)
    const candidate =
      payload.mode === 'rotate'
        ? buildRotateOutputName({
            inputName: basename(file),
            rotation: payload.options.rotation,
            flip: payload.options.flip,
            ext
          })
        : buildCropOutputName({ inputName: basename(file), options: payload.options, ext })
    const name = uniqueName(env.existing, candidate)
    env.existing.add(name.toLowerCase())
    const output = join(env.outputDir, name)
    const filterArgs =
      payload.mode === 'rotate'
        ? buildRotateFilterArgs(payload.options)
        : buildCropFilterArgs(payload.options)
    // 动图输入取首帧静态化，避免 webp 输出意外保留多帧
    const staticArgs = animated ? ['-frames:v', '1'] : []
    const encodeArgs =
      payload.mode === 'rotate' ? buildRotateEncodeArgs(ext) : buildCropEncodeArgs(ext)
    const result = await env.deps.runProcess({
      command: env.ffmpegPath,
      args: ['-y', '-v', 'error', '-i', file, ...filterArgs, ...staticArgs, ...encodeArgs, output],
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
  } else if (payload.mode === 'effect') {
    // 调整：输出沿用压缩「保持原格式」映射（gif/webp → webp 动画），质量透传
    ext = compressOutputExt(inputExt)
    quality = payload.options.quality
  } else {
    ext = payload.options.format
    quality = payload.options.quality
    // 缩放需原始尺寸：ffmpeg 探测（损坏 → 单张失败项）
    const info = await probeStream(file, env.ffmpegPath, env.deps)
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

  // 调整效果（M40 §2.4）
  const effect =
    payload.mode === 'effect'
      ? { kind: payload.options.effect, threshold: payload.options.threshold }
      : undefined
  const candidate = buildOutputName({
    inputName: basename(file),
    mode: payload.mode,
    quality,
    ...(size !== undefined ? { size } : {}),
    ...(effect !== undefined ? { effect } : {}),
    ext
  })
  const name = uniqueName(env.existing, candidate)
  env.existing.add(name.toLowerCase())
  const output = join(env.outputDir, name)

  // 效果滤镜与缩放互斥（spec §5）：调整只替换像素，不改变尺寸
  // M55 §4.55：effect 透传调色参数（schema default(0) 后字段必在）
  const filterArgs =
    payload.mode === 'effect'
      ? [
          '-vf',
          buildEffectFilter(payload.options.effect, payload.options.threshold, {
            brightness: payload.options.brightness,
            contrast: payload.options.contrast,
            saturation: payload.options.saturation,
            sharpen: payload.options.sharpen,
            blur: payload.options.blur
          })
        ]
      : scaleArgs

  const result = await env.deps.runProcess({
    command: env.ffmpegPath,
    args: [
      '-y',
      '-v',
      'error',
      '-i',
      file,
      ...filterArgs,
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
export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createDefaultDeps())
  // M72：水印 / 去水印 / 拼接三页签主进程通道（通道名已加 page 前缀避免与本包冲突）
  registerWatermarkWith(ctx, createWatermarkDeps())
  registerDewatermarkWith(ctx, createDewatermarkDeps())
  registerStitchWith(ctx, createStitchDeps())
}
