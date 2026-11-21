/**
 * @file image-crop 主进程逻辑（node-kit.runProcess + 壳任务队列三段式）
 * @author cuilanchao
 * @date 2026-11-21
 * @description config（sync，输出目录记忆）/ set-output-dir（sync，目录选择即时记忆）/
 *              process（task，批量串行 + 可取消）三通道；引擎只复用
 *              binaries/download/ffmpeg.exe（零新增依赖）。批量语义：
 *              单张失败不中断批次（spec §7）；取消 = AbortSignal 杀树，已完成文件保留。
 *              deps 可注入便于单测
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { runProcess, tail } from '@lumin/node-kit'
import { isStructuredError, makeError, uniqueFileName } from '@lumin/shared'
import type { MainPluginContext, RegisterMain, TaskHandlerContext } from '@lumin/plugin-api'
import {
  MAX_FILE_BYTES,
  configResultSchema,
  extensionOf,
  processPayloadSchema,
  processResultSchema,
  setOutputDirPayloadSchema,
  type ProcessFailure,
  type ProcessPayload,
  type ProcessResult
} from './schema'
import { errnoCode, toolError } from './errors'
import {
  buildCropFilterArgs,
  buildCropOutputName,
  buildEncodeArgs,
  classifyCropFailure
} from './crop'

/** 可注入依赖（单测传假件；image-rotate/image-toolbox node.ts 同口径） */
export interface ImageCropDeps {
  /** 进程执行器（默认 node-kit runProcess，支持超时/abort 杀树） */
  runProcess: typeof runProcess
}

/** 默认依赖（真实 runProcess） */
function createDefaultDeps(): ImageCropDeps {
  return { runProcess }
}

/**
 * 注册 image-crop 全部通道（工具注册入口，可注入 deps 供测试）
 * @param ctx 主进程插件上下文（paths/settings/log/registerIpc/registerTask）
 * @param deps 可注入依赖，默认真实 runProcess
 */
export function registerWith(ctx: MainPluginContext, deps: ImageCropDeps): void {
  const engineDir = join(ctx.paths.binaries, 'download')
  const ffmpegPath = join(engineDir, 'ffmpeg.exe')
  const defaultOutputDir = join(ctx.paths.userData, 'image-crop')

  // —— config（sync）：输出目录记忆回填（settings `outputDir`，spec §3） ——
  ctx.registerIpc('config', async () => {
    const saved = await ctx.settings.get<string | null>('outputDir', null)
    return configResultSchema.parse({ outputDir: saved ?? defaultOutputDir })
  })

  // —— set-output-dir（sync）：目录选择后即时记忆（spec §3） ——
  ctx.registerIpc('set-output-dir', async ({ payload }) => {
    const parsed = setOutputDirPayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    await ctx.settings.set('outputDir', parsed.data.outputDir)
  })

  // —— process（task）：批量串行 + 可取消，done 返回逐文件结果（spec §3/§7） ——
  ctx.registerTask<ProcessPayload, ProcessResult>('process', async (taskCtx) => {
    try {
      return await runProcessTask(taskCtx, {
        ffmpegPath,
        deps,
        settings: ctx.settings
      })
    } catch (err) {
      if (isStructuredError(err)) throw err
      if (err instanceof Error) throw toolError('IC_FILE_CORRUPT', tail(err.message))
      throw err
    }
  })

  ctx.log.info('image-crop registered', { engineDir, defaultOutputDir })
}

/** process 任务上下文所需的闭包资源（registerWith 组装，runProcessTask 消费） */
interface ProcessEnv {
  ffmpegPath: string
  deps: ImageCropDeps
  settings: MainPluginContext['settings']
}

/**
 * 执行一次批量裁剪任务：引擎预检 → 目录 precheck → 逐文件 → 逐文件结果
 * @param taskCtx 任务上下文（payload 由 zod 校验）
 * @param env 闭包资源
 */
async function runProcessTask(
  taskCtx: TaskHandlerContext<ProcessPayload>,
  env: ProcessEnv
): Promise<ProcessResult> {
  const parsed = processPayloadSchema.safeParse(taskCtx.payload)
  if (!parsed.success) {
    throw makeError('INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '参数无效')
  }
  if (!existsSync(env.ffmpegPath)) throw toolError('IC_ENGINE_MISSING')

  const input = parsed.data
  const outputDir = input.outputDir

  // 输出目录 precheck：不存在则递归创建（失败 → IC_OUTPUT_WRITE_FAILED，errno 入 detail）
  try {
    mkdirSync(outputDir, { recursive: true })
  } catch (err) {
    throw toolError('IC_OUTPUT_WRITE_FAILED', errnoCode(err))
  }
  await env.settings.set('outputDir', outputDir)

  /** 已占用输出文件名（Windows 大小写不敏感：统一 lowercase 键，含同批次已分配名） */
  let existing: Set<string>
  try {
    existing = new Set(readdirSync(outputDir).map((name) => name.toLowerCase()))
  } catch (err) {
    throw toolError('IC_OUTPUT_WRITE_FAILED', errnoCode(err))
  }

  const outputs: ProcessResult['outputs'] = []
  const failures: ProcessFailure[] = []
  const total = input.files.length

  for (const [index, file] of input.files.entries()) {
    if (taskCtx.signal.aborted) break
    taskCtx.emit({ kind: 'progress', current: index, total, message: basename(file) })
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
      if (isStructuredError(err) && err.code === 'IC_CANCELLED') break
      if (!isStructuredError(err)) {
        failures.push({
          input: file,
          code: 'IC_FILE_CORRUPT',
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
  deps: ImageCropDeps
  /** 已占用文件名集合（lowercase 键，分配后回写） */
  existing: Set<string>
  signal: AbortSignal
}

/**
 * 处理单张图片：校验 → 命名 → ffmpeg 裁剪 → 结果条目
 * @param file 输入文件绝对路径
 * @param payload zod 校验后的任务入参（outputDir + options）
 * @param env 单张处理资源
 */
async function processOne(
  file: string,
  payload: ProcessPayload,
  env: SingleEnv
): Promise<ProcessResult['outputs'][number]> {
  const ext = extensionOf(file)
  if (ext === null) throw toolError('IC_FILE_UNSUPPORTED')
  try {
    const stat = statSync(file)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw toolError('IC_FILE_UNSUPPORTED')
  } catch (err) {
    if (isStructuredError(err)) throw err
    throw toolError('IC_FILE_UNSUPPORTED', errnoCode(err))
  }

  const candidate = buildCropOutputName({
    inputName: basename(file),
    options: payload.options,
    ext
  })
  const name = uniqueFileName(env.existing, candidate)
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
      ...buildCropFilterArgs(payload.options),
      ...buildEncodeArgs(ext),
      output
    ],
    signal: env.signal,
    maxOutputChars: 256 * 1024
  })
  if (result.aborted) throw toolError('IC_CANCELLED')
  if (result.code !== 0) {
    throw toolError(classifyCropFailure(result.stderr, output), tail(result.stderr.trim()))
  }
  return { input: file, output }
}

/** 生产注册入口（壳 tool-mains.ts 调用；测试用 registerWith 注入假 deps） */
export const registerMain: RegisterMain = (ctx) => registerWith(ctx, createDefaultDeps())
