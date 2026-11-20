import { existsSync } from 'node:fs'
import { open, readFile, unlink, writeFile } from 'node:fs/promises'
import { errnoCode } from '@lumin/shared'
import { resolveConflictPath, tail } from '@lumin/node-kit'
import { PDFDocument, degrees } from 'pdf-lib'
import { toolError } from './errors'
import {
  cropDesiredPath,
  deleteDesiredPath,
  mergeDesiredPath,
  rotateDesiredPath,
  splitDesiredPaths
} from './naming'
import { parsePages, parseSplitRanges } from './ranges'
import type {
  CropPayload,
  DeletePayload,
  MergePayload,
  RotatePayload,
  SplitPayload
} from './schema'

/** 任务进度阶段（spec §4：load(0) → process(1) → write(2) → done(3)） */
export type OpStage = 'load' | 'process' | 'write' | 'done'

export interface OpProgress {
  stage: OpStage
  current: number
  total?: number
  message?: string
}

export type EmitProgress = (update: OpProgress) => void

export interface OpResult {
  outputPaths: string[]
}

const PDF_HEAD = '%PDF-'

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 读入并解析源 PDF；不存在/占用/加密/损坏 → 结构化错误（spec §5） */
async function loadSource(inputPath: string): Promise<PDFDocument> {
  let bytes: Uint8Array
  try {
    bytes = await readFile(inputPath)
  } catch (err) {
    const code = errnoCode(err)
    if (code === 'ENOENT') throw toolError('PDF_NOT_FOUND', code)
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw toolError('PDF_LOCKED', code)
    }
    throw toolError('PDF_INVALID', code || tail(messageOf(err)))
  }
  try {
    return await PDFDocument.load(bytes)
  } catch (err) {
    const message = messageOf(err)
    // spike §4：pdf-lib 加密为普通 Error，message 含 `is encrypted`
    if (message.includes('is encrypted')) throw toolError('PDF_ENCRYPTED', tail(message))
    throw toolError('PDF_INVALID', tail(message))
  }
}

/** 冲突递增解析唯一输出路径（spec §7.3；99 次耗尽 → OUTPUT_WRITE_FAILED）；ocr-ops 复用 */
export function resolveOutput(desired: string): string {
  const resolved = resolveConflictPath(desired, existsSync)
  if (resolved === null) throw toolError('OUTPUT_WRITE_FAILED', 'conflict-exhausted')
  return resolved
}

/** 写后校验（spec §7.4：size>0 且头 5 字节 `%PDF-`） */
async function verifyWritten(path: string): Promise<boolean> {
  try {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(5)
      const { bytesRead } = await handle.read(buffer, 0, 5, 0)
      return bytesRead === 5 && buffer.toString('latin1') === PDF_HEAD
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}

/** 序列化 + 内存直写目标路径 + 写后校验（spec §4/§7.4）；失败尽力清理截断半成品 */
async function writeOutput(path: string, doc: PDFDocument): Promise<void> {
  let bytes: Uint8Array
  try {
    bytes = await doc.save()
  } catch (err) {
    throw toolError('OP_FAILED', tail(messageOf(err)))
  }
  try {
    await writeFile(path, bytes)
  } catch (err) {
    await unlink(path).catch(() => undefined)
    throw toolError('OUTPUT_WRITE_FAILED', errnoCode(err) || tail(messageOf(err)))
  }
  if (!(await verifyWritten(path))) {
    await unlink(path).catch(() => undefined)
    throw toolError('OUTPUT_WRITE_FAILED', 'verify-failed')
  }
}

/** 拆分：每区间一个产物（spec §3.2）；progress current/total = 区间序号 */
export async function splitPdf(
  inputPath: string,
  rangesText: string,
  progress: EmitProgress,
  nameTemplate?: string
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const src = await loadSource(inputPath)
  const groups = parseSplitRanges(rangesText, src.getPageCount())
  const desired = splitDesiredPaths(inputPath, groups, nameTemplate)
  const outputPaths: string[] = []
  const total = groups.length
  for (const [index, pages] of groups.entries()) {
    progress({ stage: 'process', current: index, total, message: `拆分 ${index + 1}/${total}…` })
    const out = await PDFDocument.create()
    const copied = await out.copyPages(
      src,
      pages.map((page) => page - 1)
    )
    for (const page of copied) out.addPage(page)
    const desiredPath = desired[index]
    if (desiredPath === undefined) throw toolError('OP_FAILED', `missing desired[${index}]`)
    const outputPath = resolveOutput(desiredPath)
    progress({ stage: 'write', current: index, total, message: `写出 ${index + 1}/${total}…` })
    await writeOutput(outputPath, out)
    outputPaths.push(outputPath)
  }
  progress({ stage: 'done', current: total, total, message: '完成' })
  return { outputPaths }
}

/** 合并：按序复制全部页到首个输入所在目录（spec §3.2）；progress current/total = 已合并文件数 */
export async function mergePdf(
  inputPaths: readonly string[],
  progress: EmitProgress,
  nameTemplate?: string
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const out = await PDFDocument.create()
  const total = inputPaths.length
  let merged = 0
  for (const inputPath of inputPaths) {
    const src = await loadSource(inputPath)
    const copied = await out.copyPages(src, src.getPageIndices())
    for (const page of copied) out.addPage(page)
    merged += 1
    progress({ stage: 'process', current: merged, total, message: `已合并 ${merged}/${total}` })
  }
  const outputPath = resolveOutput(mergeDesiredPath(inputPaths, nameTemplate))
  progress({ stage: 'write', current: total, total, message: '写出文件…' })
  await writeOutput(outputPath, out)
  progress({ stage: 'done', current: total, total, message: '完成' })
  return { outputPaths: [outputPath] }
}

/** 删页：删除指定页保留其余（spec §3.2）；删后剩余 0 页 → NO_PAGES_LEFT */
export async function deletePages(
  inputPath: string,
  rangesText: string,
  progress: EmitProgress,
  nameTemplate?: string
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const src = await loadSource(inputPath)
  const pageCount = src.getPageCount()
  const pages = parsePages(rangesText, pageCount) ?? []
  if (pages.length >= pageCount) throw toolError('NO_PAGES_LEFT')
  const removed = new Set(pages)
  const keep = src.getPageIndices().filter((index) => !removed.has(index + 1))
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, keep)
  for (const page of copied) out.addPage(page)
  const outputPath = resolveOutput(deleteDesiredPath(inputPath, pages, nameTemplate))
  progress({ stage: 'process', current: 1, message: '处理页面…' })
  progress({ stage: 'write', current: 2, message: '写出文件…' })
  await writeOutput(outputPath, out)
  progress({ stage: 'done', current: 3, message: '完成' })
  return { outputPaths: [outputPath] }
}

/** 旋转：选中页顺时针加转（叠加当前角度；spec §3.2），空区间 = 全部页 */
export async function rotatePages(
  inputPath: string,
  rangesText: string | undefined,
  delta: 90 | 180 | 270,
  progress: EmitProgress,
  nameTemplate?: string
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const src = await loadSource(inputPath)
  const pageCount = src.getPageCount()
  const pages = parsePages(rangesText ?? '', pageCount, { allowEmpty: true }) ?? []
  const targets = pages.length === 0 ? src.getPageIndices().map((index) => index + 1) : pages
  for (const pageNumber of targets) {
    const page = src.getPage(pageNumber - 1)
    if (page === undefined) throw toolError('RANGE_INVALID', String(pageNumber))
    const current = page.getRotation().angle
    page.setRotation(degrees((current + delta) % 360))
  }
  const outputPath = resolveOutput(rotateDesiredPath(inputPath, delta, nameTemplate))
  progress({ stage: 'process', current: 1, message: '处理页面…' })
  progress({ stage: 'write', current: 2, message: '写出文件…' })
  await writeOutput(outputPath, src)
  progress({ stage: 'done', current: 3, message: '完成' })
  return { outputPaths: [outputPath] }
}

/**
 * 裁剪：box 为 0–1 比例（左上原点，renderer 按参照页归一化，spec §1），
 * 逐页按各自 MediaBox 等比应用并翻转到 PDF 左下原点坐标系；空区间 = 全部页。
 */
export async function cropPages(
  inputPath: string,
  rangesText: string | undefined,
  box: CropPayload['box'],
  progress: EmitProgress,
  nameTemplate?: string
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const src = await loadSource(inputPath)
  const pageCount = src.getPageCount()
  const pages = parsePages(rangesText ?? '', pageCount, { allowEmpty: true }) ?? []
  const targets = pages.length === 0 ? src.getPageIndices().map((index) => index + 1) : pages
  for (const pageNumber of targets) {
    const page = src.getPage(pageNumber - 1)
    if (page === undefined) throw toolError('RANGE_INVALID', String(pageNumber))
    const media = page.getMediaBox()
    const x = media.x + box.x * media.width
    const y = media.y + (1 - box.y - box.height) * media.height
    const width = box.width * media.width
    const height = box.height * media.height
    page.setCropBox(x, y, width, height)
  }
  const outputPath = resolveOutput(cropDesiredPath(inputPath, nameTemplate))
  progress({ stage: 'process', current: 1, message: '处理页面…' })
  progress({ stage: 'write', current: 2, message: '写出文件…' })
  await writeOutput(outputPath, src)
  progress({ stage: 'done', current: 3, message: '完成' })
  return { outputPaths: [outputPath] }
}

/** 载荷分发（worker 侧唯一入口；zod 校验已在 node.ts 完成） */
export type WorkerRequest =
  | { op: 'split'; payload: SplitPayload }
  | { op: 'merge'; payload: MergePayload }
  | { op: 'delete'; payload: DeletePayload }
  | { op: 'rotate'; payload: RotatePayload }
  | { op: 'crop'; payload: CropPayload }

export async function runOp(request: WorkerRequest, progress: EmitProgress): Promise<OpResult> {
  switch (request.op) {
    case 'split':
      return splitPdf(
        request.payload.inputPath,
        request.payload.ranges,
        progress,
        request.payload.nameTemplate
      )
    case 'merge':
      return mergePdf(request.payload.inputPaths, progress, request.payload.nameTemplate)
    case 'delete':
      return deletePages(
        request.payload.inputPath,
        request.payload.ranges,
        progress,
        request.payload.nameTemplate
      )
    case 'rotate':
      return rotatePages(
        request.payload.inputPath,
        request.payload.ranges,
        request.payload.degrees,
        progress,
        request.payload.nameTemplate
      )
    case 'crop':
      return cropPages(
        request.payload.inputPath,
        request.payload.ranges,
        request.payload.box,
        progress,
        request.payload.nameTemplate
      )
  }
}
