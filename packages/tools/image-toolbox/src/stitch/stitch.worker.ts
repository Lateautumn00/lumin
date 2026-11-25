/**
 * @file stitch.worker.ts 图片拼接任务（worker 线程）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 两遍处理：先逐张量尺寸（measure）→ `planLayout` 定画布 → 再逐张绘制（draw）；
 *              一次编码 → `.tmp` + rename 原子写；输出冲突 `(n)` 递增。
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { Canvas, Image } from '@napi-rs/canvas'
import { exposeTask, tail, type TaskRunContext } from '@lumin/node-kit'
import { uniqueFileName, type StructuredError } from '@lumin/shared'
import { extForEncoder, outputFileName, planLayout, planOverLimit, type Size } from './contract'
import { errnoCode, toolError } from './errors'
import type { ImageEncoder, StitchRequest, StitchResult } from './schema'

/** worker 可注入依赖（测试断言原子写/编码；生产走真实 fs 与 canvas） */
export interface StitchWorkerDeps {
  loadImage(source: Buffer): Promise<Image>
  encode(canvas: Canvas, encoder: ImageEncoder, quality: number): Promise<Buffer>
  now(): Date
}

/** 默认依赖：真实 @napi-rs/canvas 解码与编码 */
const defaultDeps: StitchWorkerDeps = {
  loadImage: (source) => loadImage(source),
  encode: async (canvas, encoder, quality) =>
    encoder === 'png' ? canvas.toBuffer('image/png') : canvas.encode(encoder, quality),
  now: () => new Date()
}

/** 读图/解码失败 → IS_IMAGE_CORRUPT（ENOENT 仍归输入无效） */
function classifyDecodeError(err: unknown): StructuredError {
  const code = errnoCode(err)
  if (code === 'ENOENT') return toolError('IS_INPUT_INVALID', code)
  return toolError('IS_IMAGE_CORRUPT', code !== '' ? code : tail(String(err)))
}

/** 写盘失败：空间/权限/路径类统一 IS_WRITE_FAILED */
function classifyWriteError(err: unknown): StructuredError {
  return toolError('IS_WRITE_FAILED', errnoCode(err) || tail(String(err)))
}

/** 读取输出目录已占用文件名（不存在时返回空集） */
async function existingNames(outputDir: string): Promise<Set<string>> {
  try {
    return new Set((await readdir(outputDir)).map((name) => name.toLowerCase()))
  } catch {
    return new Set()
  }
}

/** 解码单张并返回尺寸（0 尺寸视为损坏） */
async function measureOne(path: string, deps: StitchWorkerDeps): Promise<Size> {
  let image: Image
  try {
    image = await deps.loadImage(await readFile(path))
  } catch (err) {
    throw classifyDecodeError(err)
  }
  if (image.width <= 0 || image.height <= 0) throw toolError('IS_IMAGE_CORRUPT', '尺寸为 0')
  return { width: image.width, height: image.height }
}

/**
 * 拼接主流程（导出便于单测；exposeTask 在 worker 环境注册）
 * @param payload 请求（node 侧已解析输出目录）
 * @param ctx worker 上下文（逐张进度）
 * @param deps 可注入依赖
 */
export async function runStitch(
  payload: StitchRequest,
  ctx: TaskRunContext,
  deps: StitchWorkerDeps = defaultDeps
): Promise<StitchResult> {
  const { inputPaths, layout, encoder, quality, bgColor, outputDir } = payload
  try {
    await mkdir(outputDir, { recursive: true })
  } catch (err) {
    throw classifyWriteError(err)
  }

  const sizes: Size[] = []
  for (const [index, inputPath] of inputPaths.entries()) {
    sizes.push(await measureOne(inputPath, deps))
    ctx.emit({
      kind: 'progress',
      current: index + 1,
      total: inputPaths.length,
      stage: 'measure',
      message: basename(inputPath)
    })
  }

  const plan = planLayout(sizes, layout)
  if (plan === null) throw toolError('IS_INPUT_INVALID', '布局参数或图片尺寸无效')
  if (planOverLimit(plan)) {
    throw toolError(
      'IS_OUTPUT_TOO_LARGE',
      `${plan.width}×${plan.height} 超过 30000px / 1 亿像素上限`
    )
  }

  const canvas = createCanvas(plan.width, plan.height)
  const ctx2d = canvas.getContext('2d')
  ctx2d.fillStyle = bgColor
  ctx2d.fillRect(0, 0, plan.width, plan.height)

  for (const [index, inputPath] of inputPaths.entries()) {
    const placement = plan.placements[index]
    if (placement === undefined) throw toolError('IS_PROCESS_FAILED', '布局缺少落位')
    let source: Image
    try {
      source = await deps.loadImage(await readFile(inputPath))
    } catch (err) {
      throw classifyDecodeError(err)
    }
    ctx2d.drawImage(source, placement.x, placement.y, placement.width, placement.height)
    ctx.emit({
      kind: 'progress',
      current: index + 1,
      total: inputPaths.length,
      stage: 'draw',
      message: basename(inputPath)
    })
  }

  let bytes: Buffer
  try {
    bytes = await deps.encode(canvas, encoder, quality)
  } catch (err) {
    throw toolError('IS_PROCESS_FAILED', tail(err instanceof Error ? err.message : String(err)))
  }

  const occupied = await existingNames(outputDir)
  const name = uniqueFileName(occupied, outputFileName(deps.now(), extForEncoder(encoder)))
  const target = join(outputDir, name)
  const tmp = `${target}.tmp`
  try {
    await writeFile(tmp, bytes)
    await rename(tmp, target)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw classifyWriteError(err)
  }
  return { outputPath: target, width: plan.width, height: plan.height, count: inputPaths.length }
}

exposeTask<StitchRequest, StitchResult>(runStitch)
