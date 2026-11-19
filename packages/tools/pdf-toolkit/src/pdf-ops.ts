/**
 * @file pdf-ops.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description 六种 PDF 操作的实现（pdf-lib）：合并/拆分/删页/旋转/重排/元数据。
 *              统一 load → process → write → done 进度；写入后校验 `%PDF-` 头。
 */
import { existsSync } from 'node:fs'
import { open, readFile, unlink, writeFile } from 'node:fs/promises'
import { errnoCode, parsePageList, parseRangeGroups, type StructuredError } from '@lumin/shared'
import { resolveConflictPath, tail } from '@lumin/node-kit'
import { degrees, PDFDocument } from 'pdf-lib'
import { toolError } from './errors'
import {
  deleteDesiredPath,
  mergeDesiredPath,
  metadataDesiredPath,
  reorderDesiredPath,
  rotateDesiredPath,
  splitDesiredPaths
} from './naming'
import type {
  DeletePayload,
  MetadataPatch,
  MetadataPayload,
  MergePayload,
  PdfMetadata,
  PdfProgress,
  ReorderPayload,
  RotatePayload,
  SplitPayload
} from './schema'

/** 进度上报函数 */
export type EmitProgress = (update: PdfProgress) => void

/** 任务结果 */
export interface OpResult {
  outputPaths: string[]
}

const PDF_HEAD = '%PDF-'

/** 读文件失败中可归为「被占用」的 errno */
const LOCKED_ERRNO = new Set(['EBUSY', 'EPERM', 'EACCES'])

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** worker 请求（op 与已校验载荷） */
export type WorkerRequest =
  | { op: 'merge'; payload: MergePayload }
  | { op: 'split'; payload: SplitPayload }
  | { op: 'delete'; payload: DeletePayload }
  | { op: 'rotate'; payload: RotatePayload }
  | { op: 'reorder'; payload: ReorderPayload }
  | { op: 'metadata'; payload: MetadataPayload }

/** 读入并解析源 PDF；不存在/占用/加密/损坏 → 结构化错误 */
async function loadSource(inputPath: string): Promise<PDFDocument> {
  let bytes: Uint8Array
  try {
    bytes = await readFile(inputPath)
  } catch (err) {
    const code = errnoCode(err)
    if (code === 'ENOENT') throw toolError('PT_INPUT_INVALID', code)
    if (LOCKED_ERRNO.has(code)) throw toolError('PT_PDF_LOCKED', code)
    throw toolError('PT_PDF_CORRUPT', code || tail(messageOf(err)))
  }
  try {
    return await PDFDocument.load(bytes)
  } catch (err) {
    const message = messageOf(err)
    // pdf-lib 加密错误为普通 Error，message 含 `is encrypted`
    if (message.includes('is encrypted')) throw toolError('PT_PDF_ENCRYPTED', tail(message))
    throw toolError('PT_PDF_CORRUPT', tail(message))
  }
}

/** 冲突递增解析唯一输出路径（99 次耗尽 → PT_OUTPUT_WRITE_FAILED） */
export function resolveOutput(desired: string): string {
  const resolved = resolveConflictPath(desired, existsSync)
  if (resolved === null) throw toolError('PT_OUTPUT_WRITE_FAILED', 'conflict-exhausted')
  return resolved
}

/** 写后校验（size>0 且头 5 字节 `%PDF-`） */
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

/** 序列化 + 写盘 + 校验；失败尽力清理半成品 */
async function writeOutput(path: string, doc: PDFDocument): Promise<void> {
  let bytes: Uint8Array
  try {
    bytes = await doc.save()
  } catch (err) {
    throw toolError('PT_OP_FAILED', tail(messageOf(err)))
  }
  try {
    await writeFile(path, bytes)
  } catch (err) {
    await unlink(path).catch(() => undefined)
    throw toolError('PT_OUTPUT_WRITE_FAILED', errnoCode(err) || tail(messageOf(err)))
  }
  if (!(await verifyWritten(path))) {
    await unlink(path).catch(() => undefined)
    throw toolError('PT_OUTPUT_WRITE_FAILED', 'verify-failed')
  }
}

/** 区间解析失败 → PT_RANGE_INVALID（detail 带原因与出错片段） */
function rangeFailure(result: { reason: string; token: string }): StructuredError {
  return toolError('PT_RANGE_INVALID', `${result.reason}:${result.token}`)
}

/** 元数据缺省值归一为空串 */
function text(value: string | undefined): string {
  return value ?? ''
}

/** 读取 PDF 页数与元数据（info 通道用） */
export async function inspectPdf(
  inputPath: string
): Promise<{ pageCount: number; metadata: PdfMetadata }> {
  const doc = await loadSource(inputPath)
  return {
    pageCount: doc.getPageCount(),
    metadata: {
      title: text(doc.getTitle()),
      author: text(doc.getAuthor()),
      subject: text(doc.getSubject()),
      keywords: text(doc.getKeywords()),
      creator: text(doc.getCreator()),
      producer: text(doc.getProducer())
    }
  }
}

/** 合并：按列表顺序复制全部页 */
export async function mergePdf(
  inputPaths: readonly string[],
  progress: EmitProgress
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
  const outputPath = resolveOutput(mergeDesiredPath(inputPaths))
  progress({ stage: 'write', current: total, total, message: '写出文件…' })
  await writeOutput(outputPath, out)
  progress({ stage: 'done', current: total, total, message: '完成' })
  return { outputPaths: [outputPath] }
}

/** 拆分：每区间一个产物（区间不重叠） */
export async function splitPdf(
  inputPath: string,
  rangesText: string,
  progress: EmitProgress
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const src = await loadSource(inputPath)
  const groups = parseRangeGroups(rangesText, src.getPageCount())
  if (!groups.ok) throw rangeFailure(groups)
  const desired = splitDesiredPaths(inputPath, groups.value)
  const total = groups.value.length
  const outputPaths: string[] = []
  for (const [index, pages] of groups.value.entries()) {
    progress({ stage: 'process', current: index, total, message: `拆分 ${index + 1}/${total}…` })
    const out = await PDFDocument.create()
    const copied = await out.copyPages(
      src,
      pages.map((page) => page - 1)
    )
    for (const page of copied) out.addPage(page)
    const desiredPath = desired[index]
    if (desiredPath === undefined) throw toolError('PT_OP_FAILED', `missing desired[${index}]`)
    const outputPath = resolveOutput(desiredPath)
    progress({ stage: 'write', current: index, total, message: `写出 ${index + 1}/${total}…` })
    await writeOutput(outputPath, out)
    outputPaths.push(outputPath)
  }
  progress({ stage: 'done', current: total, total, message: '完成' })
  return { outputPaths }
}

/** 删页：删除指定页保留其余；删光 → PT_NO_PAGES_LEFT */
export async function deletePages(
  inputPath: string,
  rangesText: string,
  progress: EmitProgress
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const src = await loadSource(inputPath)
  const pageCount = src.getPageCount()
  const parsed = parsePageList(rangesText, pageCount)
  if (!parsed.ok) throw rangeFailure(parsed)
  const pages = parsed.value ?? []
  if (pages.length >= pageCount) throw toolError('PT_NO_PAGES_LEFT')
  const removed = new Set(pages)
  const keep = src.getPageIndices().filter((index) => !removed.has(index + 1))
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, keep)
  for (const page of copied) out.addPage(page)
  const outputPath = resolveOutput(deleteDesiredPath(inputPath, pages))
  progress({ stage: 'process', current: 1, message: '处理页面…' })
  progress({ stage: 'write', current: 2, message: '写出文件…' })
  await writeOutput(outputPath, out)
  progress({ stage: 'done', current: 3, message: '完成' })
  return { outputPaths: [outputPath] }
}

/** 旋转：选中页顺时针叠加（空范围 = 全部页） */
export async function rotatePages(
  inputPath: string,
  rangesText: string | undefined,
  delta: 90 | 180 | 270,
  progress: EmitProgress
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const src = await loadSource(inputPath)
  const pageCount = src.getPageCount()
  const parsed = parsePageList(rangesText ?? '', pageCount, { allowEmpty: true })
  if (!parsed.ok) throw rangeFailure(parsed)
  const pages = parsed.value ?? []
  const targets = pages.length === 0 ? src.getPageIndices().map((index) => index + 1) : pages
  for (const pageNumber of targets) {
    const page = src.getPage(pageNumber - 1)
    if (page === undefined) throw toolError('PT_RANGE_INVALID', String(pageNumber))
    const current = page.getRotation().angle
    page.setRotation(degrees((current + delta) % 360))
  }
  const outputPath = resolveOutput(rotateDesiredPath(inputPath, delta))
  progress({ stage: 'process', current: 1, message: '处理页面…' })
  progress({ stage: 'write', current: 2, message: '写出文件…' })
  await writeOutput(outputPath, src)
  progress({ stage: 'done', current: 3, message: '完成' })
  return { outputPaths: [outputPath] }
}

/** 判断 order 是否为 1..pageCount 的完整全排列 */
export function isValidOrder(order: readonly number[], pageCount: number): boolean {
  if (order.length !== pageCount) return false
  const seen = new Set<number>()
  for (const page of order) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount || seen.has(page)) return false
    seen.add(page)
  }
  return true
}

/** 重排：按 order 重写页序（必须是全排列） */
export async function reorderPages(
  inputPath: string,
  order: readonly number[],
  progress: EmitProgress
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const src = await loadSource(inputPath)
  if (!isValidOrder(order, src.getPageCount())) throw toolError('PT_ORDER_INVALID')
  const out = await PDFDocument.create()
  const copied = await out.copyPages(
    src,
    order.map((page) => page - 1)
  )
  for (const page of copied) out.addPage(page)
  const outputPath = resolveOutput(reorderDesiredPath(inputPath))
  progress({ stage: 'process', current: 1, message: '处理页面…' })
  progress({ stage: 'write', current: 2, message: '写出文件…' })
  await writeOutput(outputPath, out)
  progress({ stage: 'done', current: 3, message: '完成' })
  return { outputPaths: [outputPath] }
}

/** 元数据：仅写入非空字段（空串 = 保持原值） */
export async function writeMetadata(
  inputPath: string,
  patch: MetadataPatch,
  progress: EmitProgress
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const doc = await loadSource(inputPath)
  const valueOf = (value?: string): string => value?.trim() ?? ''
  const title = valueOf(patch.title)
  if (title !== '') doc.setTitle(title)
  const author = valueOf(patch.author)
  if (author !== '') doc.setAuthor(author)
  const subject = valueOf(patch.subject)
  if (subject !== '') doc.setSubject(subject)
  const keywords = valueOf(patch.keywords)
  if (keywords !== '') doc.setKeywords([keywords])
  const outputPath = resolveOutput(metadataDesiredPath(inputPath))
  progress({ stage: 'process', current: 1, message: '写入元数据…' })
  progress({ stage: 'write', current: 2, message: '写出文件…' })
  await writeOutput(outputPath, doc)
  progress({ stage: 'done', current: 3, message: '完成' })
  return { outputPaths: [outputPath] }
}

/** 载荷分发（worker 唯一入口；zod 校验已在 node.ts 完成） */
export async function runOp(request: WorkerRequest, progress: EmitProgress): Promise<OpResult> {
  switch (request.op) {
    case 'merge':
      return mergePdf(request.payload.inputPaths, progress)
    case 'split':
      return splitPdf(request.payload.inputPath, request.payload.ranges, progress)
    case 'delete':
      return deletePages(request.payload.inputPath, request.payload.ranges, progress)
    case 'rotate':
      return rotatePages(
        request.payload.inputPath,
        request.payload.ranges,
        request.payload.degrees,
        progress
      )
    case 'reorder':
      return reorderPages(request.payload.inputPath, request.payload.order, progress)
    case 'metadata':
      return writeMetadata(request.payload.inputPath, request.payload.metadata, progress)
  }
}
