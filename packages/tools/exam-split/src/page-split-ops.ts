/**
 * @file 试卷页面切分编排（A3 横向双页 → 两页 A4）：检测 → 裁剪 / 半页框 → 写盘。
 * @author cuilanchao
 * @date 2026-11-25
 * @description 图片与 PDF 共用同一套像素检测（page-split-detect）：
 *              - 图片：解码为原生像素 → 检测纸张边界与装订沟 → 按左/右裁像素 →
 *                同格式编码写盘（左右成对，保持原分辨率）；
 *              - PDF：逐页渲染检测 → 对源文档两次独立 copyPages 得左/右副本 →
 *                setMediaBox/CropBox 收窄为半页矩形 → 单文件 2N 页（左→右）。
 *              渲染依赖经 deps 注入（worker 传真实实现，单测注入假件）；产物 fs 直连。
 */
import { existsSync } from 'node:fs'
import { open, unlink, writeFile } from 'node:fs/promises'
import { tail } from '@lumin/node-kit'
import { isStructuredError } from '@lumin/shared'
import { PDFDocument } from 'pdf-lib'
import { toolError } from './errors'
import { halveDesiredPath, halveImageDesiredPaths, withConflictSuffix } from './naming'
import {
  encodeImage,
  type ImageEncodeFormat,
  type RenderOptions,
  type RenderedPage
} from './ocr-render'
import { cropRgbaRegion } from './ocr-preproc'
import { detectPageSplit, halfRects, isSpreadPage, normalizeRotation } from './page-split-detect'
import { loadSource, resolveOutput, writeOutput } from './pdf-ops'
import type { HalveDetection, HalvePayload, HalveResult } from './schema'

export type { HalveDetection, HalvePayload, HalveResult }

/** 切分阶段（spec §11：load → detect → write → done） */
export type HalveStage = 'load' | 'detect' | 'write' | 'done'

export interface HalveProgress {
  stage: HalveStage
  current: number
  total?: number
  message?: string
}

export type HalveEmit = (update: HalveProgress) => void

/** 编排层依赖（worker 注入真实渲染，单测注入假件） */
export interface HalveDeps {
  render(inputPath: string, options?: RenderOptions): Promise<RenderedPage[]>
}

/** worker 内部请求（IPC 入参已由 node.ts 校验为 HalvePayload） */
export type HalveWorkerRequest = HalvePayload

/** PDF 扩展名判定（与 schema 输入白名单一致，大小写不敏感） */
const PDF_EXT_RE = /\.pdf$/i

/** 冲突后缀递增上限（左右成对，同一 n 同时可用才采用） */
const MAX_CONFLICT_INDEX = 100

/** 各图片格式的写后校验魔数（PNG/JPEG 前 3–4 字节，WebP `RIFF` 头） */
const IMAGE_HEADS: Record<ImageEncodeFormat, readonly number[]> = {
  png: [0x89, 0x50, 0x4e, 0x47],
  jpeg: [0xff, 0xd8, 0xff],
  webp: [0x52, 0x49, 0x46, 0x46]
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 结构化错误透传，其余包 OP_FAILED（detail 取消息尾部） */
function wrapError(err: unknown): unknown {
  if (isStructuredError(err)) return err
  return toolError('OP_FAILED', tail(messageOf(err)))
}

/** 写后校验：读头若干字节比对魔数（防止半成品落盘） */
async function verifyHead(path: string, head: readonly number[]): Promise<boolean> {
  try {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(head.length)
      const { bytesRead } = await handle.read(buffer, 0, head.length, 0)
      return bytesRead === head.length && head.every((byte, index) => buffer[index] === byte)
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}

/** 内存直写 + 写后校验；失败清理半成品并抛 OUTPUT_WRITE_FAILED */
async function writeImageVerified(
  path: string,
  bytes: Uint8Array,
  format: ImageEncodeFormat
): Promise<void> {
  try {
    await writeFile(path, bytes)
  } catch (err) {
    await unlink(path).catch(() => undefined)
    throw toolError('OUTPUT_WRITE_FAILED', tail(messageOf(err)))
  }
  if (!(await verifyHead(path, IMAGE_HEADS[format]))) {
    await unlink(path).catch(() => undefined)
    throw toolError('OUTPUT_WRITE_FAILED', 'verify-failed')
  }
}

/** 输入扩展名 → 编码格式（.png/.webp 保真，其余按 JPEG） */
function imageFormatOf(inputPath: string): ImageEncodeFormat {
  const lower = inputPath.toLowerCase()
  if (lower.endsWith('.png')) return 'png'
  if (lower.endsWith('.webp')) return 'webp'
  return 'jpeg'
}

/** 左右成对解析唯一输出（同一 n 两侧都不存在才采用；耗尽 → OUTPUT_WRITE_FAILED） */
function resolveImagePair(leftDesired: string, rightDesired: string): [string, string] {
  for (let index = 0; index < MAX_CONFLICT_INDEX; index++) {
    const left = withConflictSuffix(leftDesired, index)
    const right = withConflictSuffix(rightDesired, index)
    if (!existsSync(left) && !existsSync(right)) return [left, right]
  }
  throw toolError('OUTPUT_WRITE_FAILED', 'conflict-exhausted')
}

/** 图片链路：单页检测 → 按纸面裁左/右 → 同格式编码成对写盘 */
async function halveImage(
  inputPath: string,
  deps: HalveDeps,
  emit: HalveEmit
): Promise<HalveResult> {
  emit({ stage: 'load', current: 0, total: 1, message: '读取图片…' })
  const pages = await deps.render(inputPath)
  const page = pages[0]
  if (page === undefined) throw toolError('OCR_INPUT_INVALID', 'empty-render')

  const detection = detectPageSplit(page.image)
  if (!isSpreadPage(detection.paper)) throw toolError('PAGE_NOT_SPREAD')
  emit({ stage: 'detect', current: 1, total: 1, message: '已定位分割线' })

  const { paper, splitX } = detection
  const left = cropRgbaRegion(page.image, {
    x: paper.x,
    y: paper.y,
    width: splitX - paper.x,
    height: paper.height
  })
  const right = cropRgbaRegion(page.image, {
    x: splitX,
    y: paper.y,
    width: paper.x + paper.width - splitX,
    height: paper.height
  })

  const format = imageFormatOf(inputPath)
  const [leftDesired, rightDesired] = halveImageDesiredPaths(inputPath)
  const [leftPath, rightPath] = resolveImagePair(leftDesired, rightDesired)

  const written: string[] = []
  try {
    emit({ stage: 'write', current: 0, total: 2, message: '写出左页…' })
    await writeImageVerified(leftPath, encodeImage(left, format), format)
    written.push(leftPath)
    emit({ stage: 'write', current: 1, total: 2, message: '写出右页…' })
    await writeImageVerified(rightPath, encodeImage(right, format), format)
    written.push(rightPath)
  } catch (err) {
    await Promise.all(written.map((path) => unlink(path).catch(() => undefined)))
    throw wrapError(err)
  }

  emit({ stage: 'done', current: 2, total: 2, message: '完成' })
  return {
    outputPaths: [leftPath, rightPath],
    detections: [
      {
        pageNumber: 1,
        splitRatio: detection.splitRatio,
        usedGutter: detection.usedGutter,
        trimmed: paper.width < page.width || paper.height < page.height
      }
    ]
  }
}

/** PDF 链路：逐页渲染检测 → 两次独立 copyPages → 半页 MediaBox/CropBox → 单文件 2N 页 */
async function halvePdf(inputPath: string, deps: HalveDeps, emit: HalveEmit): Promise<HalveResult> {
  emit({ stage: 'load', current: 0, message: '读取 PDF…' })
  const src = await loadSource(inputPath)
  const pageCount = src.getPageCount()
  if (pageCount === 0) throw toolError('PDF_INVALID', 'empty-document')

  const detections: HalveDetection[] = []
  const ratios: number[] = []
  for (let index = 0; index < pageCount; index++) {
    const pageNumber = index + 1
    emit({
      stage: 'detect',
      current: index,
      total: pageCount,
      message: `检测第 ${pageNumber}/${pageCount} 页…`
    })
    const [rendered] = await deps.render(inputPath, { pageNumbers: [pageNumber] })
    if (rendered === undefined) throw toolError('OP_FAILED', `第 ${pageNumber} 页渲染失败`)
    const detection = detectPageSplit(rendered.image)
    if (!isSpreadPage(detection.paper)) throw toolError('PAGE_NOT_SPREAD', `第 ${pageNumber} 页`)
    ratios.push(detection.splitRatio)
    detections.push({
      pageNumber,
      splitRatio: detection.splitRatio,
      usedGutter: detection.usedGutter,
      trimmed: false
    })
  }

  emit({ stage: 'write', current: 0, total: 1, message: '生成切分 PDF…' })
  const out = await PDFDocument.create()
  const indices = src.getPageIndices()
  // 同一批 copyPages 复用对象缓存，须分两次调用才能得到独立的左/右页字典
  const leftCopies = await out.copyPages(src, indices)
  const rightCopies = await out.copyPages(src, indices)
  for (let index = 0; index < indices.length; index++) {
    const srcPage = src.getPage(index)
    const leftPage = leftCopies[index]
    const rightPage = rightCopies[index]
    if (srcPage === undefined || leftPage === undefined || rightPage === undefined) {
      throw toolError('OP_FAILED', `第 ${index + 1} 页拷贝失败`)
    }
    const media = srcPage.getMediaBox()
    const rotation = normalizeRotation(srcPage.getRotation().angle)
    const { left, right } = halfRects(media, rotation, ratios[index] ?? 0.5)
    leftPage.setMediaBox(left.x, left.y, left.width, left.height)
    leftPage.setCropBox(left.x, left.y, left.width, left.height)
    rightPage.setMediaBox(right.x, right.y, right.width, right.height)
    rightPage.setCropBox(right.x, right.y, right.width, right.height)
    out.addPage(leftPage)
    out.addPage(rightPage)
  }

  const outputPath = resolveOutput(halveDesiredPath(inputPath))
  await writeOutput(outputPath, out)
  emit({ stage: 'done', current: 1, total: 1, message: '完成' })
  return { outputPaths: [outputPath], detections }
}

/**
 * 页面切分入口：按扩展名分派图片 / PDF 链路，统一异常归一。
 * 竖版（宽 < 高 × 1.15）→ PAGE_NOT_SPREAD（spec §11 明确不支持）。
 */
export async function runHalve(
  inputPath: string,
  deps: HalveDeps,
  emit: HalveEmit
): Promise<HalveResult> {
  try {
    return PDF_EXT_RE.test(inputPath)
      ? await halvePdf(inputPath, deps, emit)
      : await halveImage(inputPath, deps, emit)
  } catch (err) {
    throw wrapError(err)
  }
}
