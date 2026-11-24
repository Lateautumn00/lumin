/**
 * @file dewatermark.worker.ts 图片去水印任务（worker 线程）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 解码 → 逐区域填充（快速修复/模糊/纯色）→ 原格式编码 → `.tmp` + rename 原子写；
 *              原图不改，输出冲突 `(n)` 递增；快速修复超 2M 像素降级模糊并回传提示。
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { Canvas, Image } from '@napi-rs/canvas'
import { exposeTask, tail, type TaskRunContext } from '@lumin/node-kit'
import { uniqueFileName, type StructuredError } from '@lumin/shared'
import {
  encoderFor,
  expandRegion,
  INPAINT_MARGIN,
  isRegionOversized,
  normalizeRegions,
  outputName,
  readChannel
} from './contract'
import { errnoCode, toolError } from './errors'
import { averageEdgeColor, blurRegion, fillSolid, teleaInpaint } from './inpaint'
import {
  MAX_DIMENSION,
  type DewatermarkRequest,
  type DewatermarkResult,
  type Encoder,
  type Region
} from './schema'

/** 有损编码质量 */
export const LOSSY_QUALITY = 90

/** worker 可注入依赖（测试断言编码失败/替换解码） */
export interface DewatermarkWorkerDeps {
  loadImage(source: Buffer): Promise<Image>
  encode(canvas: Canvas, encoder: Encoder): Promise<Buffer>
}

/** 默认依赖：真实 @napi-rs/canvas 解码与编码 */
const defaultDeps: DewatermarkWorkerDeps = {
  loadImage: (source) => loadImage(source),
  encode: async (canvas, encoder) =>
    encoder === 'png' ? canvas.toBuffer('image/png') : canvas.encode(encoder, LOSSY_QUALITY)
}

/** 错误详情：优先 errno 码，否则截断错误文本 */
function errorDetail(err: unknown): string {
  const code = errnoCode(err)
  return code !== '' ? code : tail(String(err))
}

/** 读图/解码失败 → IDW_IMAGE_CORRUPT（ENOENT 仍归输入无效） */
function classifyDecodeError(err: unknown): StructuredError {
  const code = errnoCode(err)
  if (code === 'ENOENT') return toolError('IDW_INPUT_INVALID', code)
  return toolError('IDW_IMAGE_CORRUPT', errorDetail(err))
}

/** 写盘失败：空间/权限/路径类统一 IDW_WRITE_FAILED */
function classifyWriteError(err: unknown): StructuredError {
  return toolError('IDW_WRITE_FAILED', errorDetail(err))
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
 * 快速修复单区域：外扩 bbox 子图 + 相对二值掩码 → Telea → 只回写掩码像素
 * @param pixels 整图 RGBA（原地修改）
 * @param width 图宽
 * @param height 图高
 * @param region 目标区域（已归一）
 */
export function inpaintRegion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  region: Region
): void {
  const bbox = expandRegion(region, INPAINT_MARGIN, width, height)
  const subWidth = bbox.width
  const subHeight = bbox.height
  const sub = new Uint8ClampedArray(subWidth * subHeight * 4)
  const mask = new Uint8Array(subWidth * subHeight)
  const offsetX = region.x - bbox.x
  const offsetY = region.y - bbox.y
  for (let y = 0; y < subHeight; y++) {
    for (let x = 0; x < subWidth; x++) {
      const source = ((bbox.y + y) * width + (bbox.x + x)) * 4
      const target = (y * subWidth + x) * 4
      sub[target] = readChannel(pixels, source)
      sub[target + 1] = readChannel(pixels, source + 1)
      sub[target + 2] = readChannel(pixels, source + 2)
      sub[target + 3] = readChannel(pixels, source + 3)
      const inside =
        x >= offsetX && x < offsetX + region.width && y >= offsetY && y < offsetY + region.height
      mask[y * subWidth + x] = inside ? 1 : 0
    }
  }
  teleaInpaint(sub, subWidth, subHeight, mask)
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      const local = ((offsetY + y) * subWidth + (offsetX + x)) * 4
      const target = ((region.y + y) * width + (region.x + x)) * 4
      pixels[target] = readChannel(sub, local)
      pixels[target + 1] = readChannel(sub, local + 1)
      pixels[target + 2] = readChannel(sub, local + 2)
      pixels[target + 3] = readChannel(sub, local + 3)
    }
  }
}

/**
 * 按模式填充单个区域
 * @param pixels 整图 RGBA（原地修改）
 * @param width 图宽
 * @param height 图高
 * @param region 目标区域
 * @param mode 填充模式
 * @param blurRadius 模糊半径
 * @param index 区域序号（0 基，用于提示文案）
 * @param warnings 降级/提示收集
 */
function fillRegion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  region: Region,
  mode: DewatermarkRequest['mode'],
  blurRadius: number,
  index: number,
  warnings: string[]
): void {
  if (mode === 'solid') {
    fillSolid(pixels, width, height, region, averageEdgeColor(pixels, width, height, region))
    return
  }
  if (mode === 'blur') {
    blurRegion(pixels, width, height, region, blurRadius)
    return
  }
  if (isRegionOversized(region)) {
    warnings.push(`区域 ${index + 1} 面积过大，已改用模糊填充`)
    blurRegion(pixels, width, height, region, blurRadius)
    return
  }
  inpaintRegion(pixels, width, height, region)
}

/**
 * 去水印主流程（导出便于单测；exposeTask 在 worker 环境注册）
 * @param payload 请求（node 侧已解析输出目录）
 * @param ctx worker 上下文（逐区域进度）
 * @param deps 可注入依赖
 */
export async function runDewatermark(
  payload: DewatermarkRequest,
  ctx: TaskRunContext,
  deps: DewatermarkWorkerDeps = defaultDeps
): Promise<DewatermarkResult> {
  const encoder = encoderFor(payload.inputPath)
  if (encoder === null) throw toolError('IDW_INPUT_INVALID', '仅支持 PNG/JPG/WebP')

  let image: Image
  try {
    image = await deps.loadImage(await readFile(payload.inputPath))
  } catch (err) {
    throw classifyDecodeError(err)
  }
  const width = image.width
  const height = image.height
  if (width <= 0 || height <= 0) throw toolError('IDW_IMAGE_CORRUPT', '尺寸为 0')
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw toolError('IDW_IMAGE_TOO_LARGE', `${width}×${height}`)
  }

  const regions = normalizeRegions(payload.regions, width, height)
  if (regions.length === 0) throw toolError('IDW_NO_REGIONS')

  try {
    await mkdir(payload.outputDir, { recursive: true })
  } catch (err) {
    throw classifyWriteError(err)
  }

  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const imageData = context.getImageData(0, 0, width, height)
  const pixels = imageData.data
  const warnings: string[] = []
  const total = regions.length

  for (const [index, region] of regions.entries()) {
    ctx.emit({
      kind: 'progress',
      current: index,
      total,
      stage: 'dewatermark',
      message: `处理区域 ${index + 1}/${total}`
    })
    fillRegion(pixels, width, height, region, payload.mode, payload.blurRadius, index, warnings)
  }
  ctx.emit({
    kind: 'progress',
    current: total,
    total,
    stage: 'dewatermark',
    message: '编码输出…'
  })

  context.putImageData(imageData, 0, 0)
  let bytes: Buffer
  try {
    bytes = await deps.encode(canvas, encoder)
  } catch (err) {
    throw toolError('IDW_INPAINT_FAILED', tail(err instanceof Error ? err.message : String(err)))
  }

  const occupied = await existingNames(payload.outputDir)
  const name = uniqueFileName(occupied, basename(outputName(payload.inputPath)))
  const target = join(payload.outputDir, name)
  const tmp = `${target}.tmp`
  try {
    await writeFile(tmp, bytes)
    await rename(tmp, target)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw classifyWriteError(err)
  }
  return { output: target, warnings }
}

exposeTask<DewatermarkRequest, DewatermarkResult>(runDewatermark)
