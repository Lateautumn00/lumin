/**
 * @file split.worker.ts 长图分割任务（worker 线程，M40）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 单张长图 → `planSplit` 切段 → 逐段 canvas 裁剪绘制 → 按输入扩展名编码 →
 *              `.tmp` + rename 原子写；输出冲突 `(n)` 递增；取消/失败不留 `.tmp`
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { Canvas, Image } from '@napi-rs/canvas'
import { exposeTask, tail, type TaskRunContext } from '@lumin/node-kit'
import { uniqueFileName, type StructuredError } from '@lumin/shared'
import { MAX_CANVAS_EDGE, planSplit, splitFileName } from './contract'
import { errnoCode, toolError } from './errors'
import type { SplitRequest, SplitResult } from './schema'

/** worker 可注入依赖（测试断言编码/原子写；生产走真实 fs 与 canvas） */
export interface SplitWorkerDeps {
  loadImage(source: Buffer): Promise<Image>
  encode(canvas: Canvas, encoder: 'png' | 'jpeg' | 'webp', quality: number): Promise<Buffer>
}

/** 默认依赖：真实 @napi-rs/canvas 解码与编码 */
const defaultDeps: SplitWorkerDeps = {
  loadImage: (source) => loadImage(source),
  encode: async (canvas, encoder, quality) =>
    encoder === 'png' ? canvas.toBuffer('image/png') : canvas.encode(encoder, quality)
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

/** 输入扩展名 → 输出扩展名与编码器（沿用输入格式，jpeg 保留原扩展名） */
export function inputEncodingOf(inputPath: string): {
  ext: string
  encoder: 'png' | 'jpeg' | 'webp'
  lossless: boolean
} {
  const dot = inputPath.lastIndexOf('.')
  const raw = dot === -1 ? '' : inputPath.slice(dot + 1).toLowerCase()
  if (raw === 'png') return { ext: 'png', encoder: 'png', lossless: true }
  if (raw === 'webp') return { ext: 'webp', encoder: 'webp', lossless: false }
  if (raw === 'jpeg') return { ext: 'jpeg', encoder: 'jpeg', lossless: false }
  return { ext: 'jpg', encoder: 'jpeg', lossless: false }
}

/** 读取输出目录已占用文件名（不存在时返回空集） */
async function existingNames(outputDir: string): Promise<Set<string>> {
  try {
    return new Set((await readdir(outputDir)).map((name) => name.toLowerCase()))
  } catch {
    return new Set()
  }
}

/**
 * 长图分割主流程（导出便于单测；exposeTask 在 worker 环境注册）
 * @param payload 请求（node 侧已解析输出目录）
 * @param ctx worker 上下文（读取/切分进度）
 * @param deps 可注入依赖
 */
export async function runSplit(
  payload: SplitRequest,
  ctx: TaskRunContext,
  deps: SplitWorkerDeps = defaultDeps
): Promise<SplitResult> {
  const { inputPath, mode, height, parts, quality, outputDir } = payload
  try {
    await mkdir(outputDir, { recursive: true })
  } catch (err) {
    throw classifyWriteError(err)
  }

  let source: Image
  try {
    source = await deps.loadImage(await readFile(inputPath))
  } catch (err) {
    throw classifyDecodeError(err)
  }
  if (source.width <= 0 || source.height <= 0) throw toolError('IS_IMAGE_CORRUPT', '尺寸为 0')
  if (source.width > MAX_CANVAS_EDGE || source.height > MAX_CANVAS_EDGE) {
    throw toolError('IS_SPLIT_INVALID', `${source.width}×${source.height} 超过 30000px 上限`)
  }
  ctx.emit({
    kind: 'progress',
    current: 1,
    total: 1,
    stage: 'read',
    message: basename(inputPath)
  })

  const plan = planSplit(source.height, mode, mode === 'height' ? height : parts)
  if (plan === null) {
    throw toolError(
      'IS_SPLIT_INVALID',
      `mode=${mode} height=${height} parts=${parts} 源图高 ${source.height}`
    )
  }

  const { ext, encoder } = inputEncodingOf(inputPath)
  const occupied = await existingNames(outputDir)
  const total = plan.slices.length
  const outputs: SplitResult['outputs'] = []

  for (const [index, slice] of plan.slices.entries()) {
    const canvas = createCanvas(source.width, slice.h)
    const ctx2d = canvas.getContext('2d')
    // 源图按 y 偏移裁出当前段（9 参 drawImage 显式裁剪）
    ctx2d.drawImage(source, 0, slice.y, source.width, slice.h, 0, 0, source.width, slice.h)

    let bytes: Buffer
    try {
      bytes = await deps.encode(canvas, encoder, quality)
    } catch (err) {
      throw toolError('IS_PROCESS_FAILED', tail(err instanceof Error ? err.message : String(err)))
    }

    const name = uniqueFileName(occupied, splitFileName(basename(inputPath), index + 1, total, ext))
    occupied.add(name.toLowerCase())
    const target = join(outputDir, name)
    const tmp = `${target}.tmp`
    try {
      await writeFile(tmp, bytes)
      await rename(tmp, target)
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined)
      throw classifyWriteError(err)
    }
    outputs.push({ path: target, width: source.width, height: slice.h })
    ctx.emit({
      kind: 'progress',
      current: index + 1,
      total,
      stage: 'split',
      message: name
    })
  }

  return { outputs, sourceWidth: source.width, sourceHeight: source.height }
}

exposeTask<SplitRequest, SplitResult>(runSplit)
