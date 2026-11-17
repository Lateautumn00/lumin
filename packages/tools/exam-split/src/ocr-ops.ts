/**
 * OCR 任务编排（spec §10.4 两段式：detect → 渲染端微调 → export）。
 * 渲染与推理引擎经 `deps` 注入（单测用假件）；产物 fs 直连（真临时目录可测）。
 *
 * 阶段口径（spec §10.4）：
 * - detect：`render | detect | cluster`，带 current/total/message
 * - export：仅 `write`，带 current/total、**不带 message**
 */
import { open, unlink, writeFile } from 'node:fs/promises'
import { tail } from '@lumin/node-kit'
import { isStructuredError, errnoCode } from '@lumin/shared'
import { PDFDocument } from 'pdf-lib'
import { toolError } from './errors'
import { clusterPage } from './ocr-cluster'
import { ocrPdfDesiredPath, ocrPngDesiredPath } from './naming'
import type { OcrEngine } from './ocr-model'
import { cropRgbaRegion } from './ocr-preproc'
import { encodePng, PDF_RENDER_SCALE, type RenderOptions, type RenderedPage } from './ocr-render'
import { resolveOutput } from './pdf-ops'
import type {
  OcrDetectPayload,
  OcrDetectResult,
  OcrExportPayload,
  OcrPage,
  OcrRegion,
  OpResult
} from './schema'

export type OcrStage = 'render' | 'detect' | 'cluster' | 'write'

export interface OcrProgress {
  stage: OcrStage
  current: number
  total: number
  /** detect 侧阶段文案；export（write）不带 message（spec §10.4） */
  message?: string
}

export type OcrEmit = (update: OcrProgress) => void

/** 编排层依赖（worker 注入真实实现，单测注入假件） */
export interface OcrDeps {
  render(inputPath: string, options?: RenderOptions): Promise<RenderedPage[]>
  createEngine(ocrDir: string): Promise<OcrEngine>
}

/** worker 内部请求（`binariesDir` 仅进 worker，不进 IPC schema，IPC 入参仍 `{ inputPath }`） */
export type OcrWorkerRequest =
  | { op: 'detect'; payload: OcrDetectPayload; binariesDir: string }
  | { op: 'export'; payload: OcrExportPayload }

export type OcrTaskResult = OcrDetectResult | OpResult

const PNG_HEAD = '\x89PNG'
const PDF_HEAD = '%PDF-'

/** 引擎/渲染异常 → 结构化（已结构化透传，否则 OCR_FAILED + 消息尾部，spec §10.5） */
function wrapEngineError(err: unknown): unknown {
  if (isStructuredError(err)) return err
  const message = err instanceof Error ? err.message : String(err)
  return toolError('OCR_FAILED', tail(message))
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 写后校验：读头 N 字节比对（PNG `89504E47` / PDF `%PDF-`，spec §10.7.3） */
async function verifyHead(path: string, expected: string): Promise<boolean> {
  try {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(expected.length)
      const { bytesRead } = await handle.read(buffer, 0, expected.length, 0)
      return bytesRead === expected.length && buffer.toString('latin1') === expected
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}

/** 内存直写 + 写后校验；失败清理本文件半成品并抛 OUTPUT_WRITE_FAILED */
async function writeVerified(path: string, bytes: Uint8Array, head: string): Promise<void> {
  try {
    await writeFile(path, bytes)
  } catch (err) {
    await unlink(path).catch(() => undefined)
    throw toolError('OUTPUT_WRITE_FAILED', errnoCode(err) || tail(messageOf(err)))
  }
  if (!(await verifyHead(path, head))) {
    await unlink(path).catch(() => undefined)
    throw toolError('OUTPUT_WRITE_FAILED', 'verify-failed')
  }
}

/** detect：渲染 → 建引擎 → 逐页识别 + 聚类（spec §10.4）；全页 0 题区 → NO_REGIONS */
async function runDetect(
  request: Extract<OcrWorkerRequest, { op: 'detect' }>,
  deps: OcrDeps,
  emit: OcrEmit
): Promise<OcrDetectResult> {
  try {
    const pages = await deps.render(request.payload.inputPath, {
      onPage: (done, total) =>
        emit({ stage: 'render', current: done, total, message: `渲染 ${done}/${total} 页…` })
    })
    const total = pages.length
    emit({ stage: 'detect', current: 0, total, message: '加载识别模型…' })
    const engine = await deps.createEngine(request.binariesDir)
    const out: OcrPage[] = []
    let regionCount = 0
    for (let index = 0; index < total; index++) {
      const page = pages[index]
      if (page === undefined) continue
      emit({ stage: 'detect', current: index, total, message: `识别第 ${index + 1}/${total} 页…` })
      const lines = await engine.detectLines(page.image)
      emit({
        stage: 'cluster',
        current: index + 1,
        total,
        message: `切分第 ${index + 1}/${total} 页…`
      })
      const regions = clusterPage(lines)
      regionCount += regions.length
      out.push({ pageNumber: page.pageNumber, width: page.width, height: page.height, regions })
    }
    if (regionCount === 0) throw toolError('NO_REGIONS')
    return { pages: out }
  } catch (err) {
    throw wrapEngineError(err)
  }
}

/** 归一化题区 → 像素矩形（floor/ceil 保证不截断，cropRgbaRegion 再夹到图内） */
function regionRect(
  region: OcrRegion,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const x0 = Math.floor((region.xStart ?? 0) * width)
  const x1 = Math.ceil((region.xEnd ?? 1) * width)
  const y0 = Math.floor(region.start * height)
  const y1 = Math.ceil(region.end * height)
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** 每题一页拼接（spec §10.1）；页尺寸 = 像素 ÷ 渲染倍率（还原 PDF 点数口径） */
async function buildQuestionsPdf(
  items: readonly { bytes: Buffer; width: number; height: number }[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (const item of items) {
    const image = await doc.embedPng(item.bytes)
    const pageWidth = item.width / PDF_RENDER_SCALE
    const pageHeight = item.height / PDF_RENDER_SCALE
    const page = doc.addPage([pageWidth, pageHeight])
    page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight })
  }
  return doc.save()
}

/** export：按页序+题序连续编号写出每题 PNG，可选合成 PDF；任一失败清理本批半成品 */
async function runExport(
  request: Extract<OcrWorkerRequest, { op: 'export' }>,
  deps: OcrDeps,
  emit: OcrEmit
): Promise<OpResult> {
  const { payload } = request
  const ordered = [...payload.pages].sort((a, b) => a.pageNumber - b.pageNumber)
  const regionTotal = ordered.reduce((count, page) => count + page.regions.length, 0)
  const totalFiles = regionTotal + (payload.exportPdf ? 1 : 0)
  emit({ stage: 'write', current: 0, total: totalFiles })

  let rendered: RenderedPage[]
  try {
    rendered = await deps.render(payload.inputPath, {
      pageNumbers: ordered.map((page) => page.pageNumber)
    })
  } catch (err) {
    // 重渲染阶段：读/解码错误已结构化透传，页边界与文件不匹配 → INVALID_PAYLOAD
    if (isStructuredError(err)) throw err
    throw toolError('INVALID_PAYLOAD', tail(messageOf(err)))
  }
  const byNumber = new Map(rendered.map((page) => [page.pageNumber, page]))

  const written: string[] = []
  const outputPaths: string[] = []
  try {
    const embedded: { bytes: Buffer; width: number; height: number }[] = []
    let index = 0
    for (const page of ordered) {
      const renderedPage = byNumber.get(page.pageNumber)
      if (renderedPage === undefined) {
        throw toolError('INVALID_PAYLOAD', `页 ${page.pageNumber} 未渲染`)
      }
      for (const region of page.regions) {
        const number = payload.startNumber + index
        const cropped = cropRgbaRegion(
          renderedPage.image,
          regionRect(region, renderedPage.width, renderedPage.height)
        )
        const bytes = encodePng(cropped)
        const path = resolveOutput(ocrPngDesiredPath(payload.inputPath, number))
        await writeVerified(path, bytes, PNG_HEAD)
        written.push(path)
        outputPaths.push(path)
        embedded.push({ bytes, width: cropped.width, height: cropped.height })
        index += 1
        emit({ stage: 'write', current: index, total: totalFiles })
      }
    }
    if (payload.exportPdf) {
      const path = resolveOutput(ocrPdfDesiredPath(payload.inputPath))
      await writeVerified(path, await buildQuestionsPdf(embedded), PDF_HEAD)
      written.push(path)
      outputPaths.push(path)
      emit({ stage: 'write', current: totalFiles, total: totalFiles })
    }
  } catch (err) {
    await Promise.all(written.map((path) => unlink(path).catch(() => undefined)))
    if (isStructuredError(err)) throw err
    throw toolError('OUTPUT_WRITE_FAILED', tail(messageOf(err)))
  }
  return { outputPaths }
}

/** 载荷分发（worker 侧唯一入口；zod 校验已在 node.ts 完成） */
export async function runOcrOp(
  request: OcrWorkerRequest,
  deps: OcrDeps,
  emit: OcrEmit
): Promise<OcrTaskResult> {
  if (request.op === 'detect') return runDetect(request, deps, emit)
  return runExport(request, deps, emit)
}
