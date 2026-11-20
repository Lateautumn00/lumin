/**
 * @file watermark.worker.ts 图片批量水印任务（worker 线程）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 逐张解码 → 画布叠加水印 → 原格式编码 → `.tmp` + rename 原子写；
 *              单张失败记入 failures 不中断整批；输出冲突 `(n)` 递增，绝不覆盖原图。
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { Canvas, Image, SKRSContext2D } from '@napi-rs/canvas'
import { exposeTask, tail, type TaskRunContext } from '@lumin/node-kit'
import { ensureCjkFont } from '@lumin/node-kit/pdf'
import { uniqueFileName, type StructuredError } from '@lumin/shared'
import {
  anchorPosition,
  clampOpacity,
  encoderFor,
  imageWatermarkSize,
  normalizeRotation,
  outputName,
  percentToPx,
  shortEdge,
  textFontSize,
  textHeight,
  tilePositions,
  type Point
} from './contract'
import { errnoCode, isStructuredError, toolError } from './errors'
import type {
  Encoder,
  Watermark,
  WatermarkFailure,
  WatermarkRequest,
  WatermarkResult
} from './schema'

/** 画布字体栈（worker 已注册 YaHei，其余回退系统字体） */
export const FONT_STACK = 'YaHei, "Microsoft YaHei", "PingFang SC", sans-serif'

/** 有损编码质量 */
export const LOSSY_QUALITY = 90

/** worker 可注入依赖（测试断言原子写/编码；生产走真实 fs 与 canvas） */
export interface WatermarkWorkerDeps {
  loadImage(source: Buffer): Promise<Image>
  encode(canvas: Canvas, encoder: Encoder): Promise<Buffer>
}

/** 默认依赖：真实 @napi-rs/canvas 解码与编码 */
const defaultDeps: WatermarkWorkerDeps = {
  loadImage: (source) => loadImage(source),
  encode: async (canvas, encoder) =>
    encoder === 'png' ? canvas.toBuffer('image/png') : canvas.encode(encoder, LOSSY_QUALITY)
}

/** 读图/解码失败 → IW_IMAGE_CORRUPT（ENOENT 仍归输入无效） */
function classifyDecodeError(err: unknown): StructuredError {
  const code = errnoCode(err)
  if (code === 'ENOENT') return toolError('IW_INPUT_INVALID', code)
  return toolError('IW_IMAGE_CORRUPT', code !== '' ? code : tail(String(err)))
}

/** 写盘失败：空间/权限/路径类统一 IW_WRITE_FAILED */
function classifyWriteError(err: unknown): StructuredError {
  return toolError('IW_WRITE_FAILED', errnoCode(err) || tail(String(err)))
}

/** 读取输出目录已占用文件名（不存在时返回空集） */
async function existingNames(outputDir: string): Promise<Set<string>> {
  try {
    return new Set((await readdir(outputDir)).map((name) => name.toLowerCase()))
  } catch {
    return new Set()
  }
}

/** 计算本张图的水印中心点（平铺或九宫格） */
function markCenters(
  canvasW: number,
  canvasH: number,
  markW: number,
  markH: number,
  watermark: Watermark,
  edge: number
): Point[] {
  const rotation = normalizeRotation(watermark.rotation)
  if (watermark.tile) return tilePositions(canvasW, canvasH, markW, markH, rotation)
  const margin = percentToPx(watermark.marginPct, edge)
  return [anchorPosition(canvasW, canvasH, markW, markH, watermark.position, margin)]
}

/**
 * 在画布上逐点绘制文字水印
 * @returns 是否成功绘制（文字测宽为正）
 */
function drawTextWatermark(
  ctx: SKRSContext2D,
  watermark: Extract<Watermark, { type: 'text' }>,
  canvasW: number,
  canvasH: number,
  edge: number
): void {
  const fontPx = textFontSize(watermark.sizePct, edge)
  const font = `600 ${fontPx}px ${FONT_STACK}`
  ctx.font = font
  const text = watermark.text.trim()
  const markW = Math.max(1, Math.ceil(ctx.measureText(text).width))
  const markH = textHeight(fontPx)
  const rotation = normalizeRotation(watermark.rotation)
  const rad = (rotation * Math.PI) / 180
  const alpha = clampOpacity(watermark.opacity)
  for (const point of markCenters(canvasW, canvasH, markW, markH, watermark, edge)) {
    ctx.save()
    ctx.translate(point.x, point.y)
    ctx.rotate(rad)
    ctx.globalAlpha = alpha
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = watermark.color
    ctx.fillText(text, 0, 0)
    ctx.restore()
  }
}

/** 在画布上逐点绘制图片水印 */
function drawImageWatermark(
  ctx: SKRSContext2D,
  watermark: Extract<Watermark, { type: 'image' }>,
  source: Image,
  canvasW: number,
  canvasH: number,
  edge: number
): void {
  const size = imageWatermarkSize(source.width, source.height, watermark.sizePct, edge)
  if (size === null) throw toolError('IW_WATERMARK_INVALID', '水印尺寸无效')
  const rotation = normalizeRotation(watermark.rotation)
  const rad = (rotation * Math.PI) / 180
  const alpha = clampOpacity(watermark.opacity)
  for (const point of markCenters(canvasW, canvasH, size.width, size.height, watermark, edge)) {
    ctx.save()
    ctx.translate(point.x, point.y)
    ctx.rotate(rad)
    ctx.globalAlpha = alpha
    ctx.drawImage(source, -size.width / 2, -size.height / 2, size.width, size.height)
    ctx.restore()
  }
}

/**
 * 处理单张图片：解码 → 叠加 → 编码 → 原子写盘
 * @param inputPath 源图片路径
 * @param watermark 水印参数
 * @param outputDir 输出目录（已存在）
 * @param occupied 已占用文件名集合（含同批次已分配名，调用后写入新名）
 * @param watermarkImage 图片水印（每任务解码一次复用）
 * @param deps 可注入依赖
 * @returns 输出绝对路径
 */
async function processOne(
  inputPath: string,
  watermark: Watermark,
  outputDir: string,
  occupied: Set<string>,
  watermarkImage: Image | undefined,
  deps: WatermarkWorkerDeps
): Promise<string> {
  const encoder = encoderFor(inputPath)
  if (encoder === null) throw toolError('IW_INPUT_INVALID', '仅支持 PNG/JPG/WebP')
  let source: Image
  try {
    source = await deps.loadImage(await readFile(inputPath))
  } catch (err) {
    throw classifyDecodeError(err)
  }
  const width = source.width
  const height = source.height
  if (width <= 0 || height <= 0) throw toolError('IW_IMAGE_CORRUPT', '尺寸为 0')

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, 0, 0)
  const edge = shortEdge(width, height)
  if (watermark.type === 'text') {
    drawTextWatermark(ctx, watermark, width, height, edge)
  } else {
    if (watermarkImage === undefined) throw toolError('IW_WATERMARK_INVALID', '水印图片未加载')
    drawImageWatermark(ctx, watermark, watermarkImage, width, height, edge)
  }

  let bytes: Buffer
  try {
    bytes = await deps.encode(canvas, encoder)
  } catch (err) {
    throw toolError('IW_PROCESS_FAILED', tail(err instanceof Error ? err.message : String(err)))
  }

  const name = uniqueFileName(occupied, basename(outputName(inputPath)))
  occupied.add(name)
  const target = join(outputDir, name)
  const tmp = `${target}.tmp`
  try {
    await writeFile(tmp, bytes)
    await rename(tmp, target)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw classifyWriteError(err)
  }
  return target
}

/** 失败项投影（单张失败不中断整批） */
function toFailure(file: string, err: StructuredError): WatermarkFailure {
  return err.detail === undefined || err.detail === ''
    ? { file, code: err.code, message: err.message }
    : { file, code: err.code, message: err.message, detail: err.detail }
}

/**
 * 批量水印主流程（导出便于单测；exposeTask 在 worker 环境注册）
 * @param payload 请求（node 侧已解析输出目录）
 * @param ctx worker 上下文（emit 逐张进度）
 * @param deps 可注入依赖
 */
export async function runWatermark(
  payload: WatermarkRequest,
  ctx: TaskRunContext,
  deps: WatermarkWorkerDeps = defaultDeps
): Promise<WatermarkResult> {
  const { inputPaths, watermark, outputDir } = payload
  try {
    await mkdir(outputDir, { recursive: true })
  } catch (err) {
    throw classifyWriteError(err)
  }
  if (watermark.type === 'text') ensureCjkFont()

  let watermarkImage: Image | undefined
  if (watermark.type === 'image') {
    try {
      watermarkImage = await deps.loadImage(await readFile(watermark.watermarkPath))
    } catch (err) {
      throw classifyDecodeError(err)
    }
  }

  const occupied = await existingNames(outputDir)
  const outputs: string[] = []
  const failures: WatermarkFailure[] = []

  for (const [index, inputPath] of inputPaths.entries()) {
    const label = basename(inputPath)
    try {
      outputs.push(await processOne(inputPath, watermark, outputDir, occupied, watermarkImage, deps))
    } catch (err) {
      const structured = isStructuredError(err)
        ? err
        : toolError('IW_PROCESS_FAILED', tail(err instanceof Error ? err.message : String(err)))
      failures.push(toFailure(label, structured))
    }
    ctx.emit({
      kind: 'progress',
      current: index + 1,
      total: inputPaths.length,
      stage: 'watermark',
      message: label
    })
  }

  if (outputs.length === 0) {
    const first = failures[0]
    if (first !== undefined) {
      throw first.detail === undefined || first.detail === ''
        ? { code: first.code, message: first.message }
        : { code: first.code, message: first.message, detail: first.detail }
    }
    throw toolError('IW_PROCESS_FAILED')
  }
  return { outputs, failures }
}

exposeTask<WatermarkRequest, WatermarkResult>(runWatermark)
