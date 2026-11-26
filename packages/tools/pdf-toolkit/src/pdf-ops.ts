/**
 * @file pdf-ops.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description 六种 PDF 操作的实现（pdf-lib）：合并/拆分/删页/旋转/重排/元数据。
 *              统一 load → process → write → done 进度；写入后校验 `%PDF-` 头。
 */
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  errnoCode,
  formatBytes,
  parsePageList,
  parseRangeGroups,
  type StructuredError
} from '@lumin/shared'
import { resolveConflictPath, tail } from '@lumin/node-kit'
import {
  encodeCanvas,
  ExtractedImageLimitError,
  extractPdfImages,
  extractPdfLines,
  extractPdfText,
  openPdf,
  renderPageToCanvas,
  type OpenedPdf
} from '@lumin/node-kit/pdf'
import { degrees, PDFDocument, rgb, StandardFonts, type PDFImage } from 'pdf-lib'
import { toolError } from './errors'
import {
  compressDesiredPath,
  deleteDesiredPath,
  exportHtmlDesiredPath,
  extractImagesDesiredDir,
  extractTextDesiredPath,
  mergeDesiredPath,
  metadataDesiredPath,
  pageNumbersDesiredPath,
  reorderDesiredPath,
  rotateDesiredPath,
  splitDesiredPaths,
  watermarkDesiredPath
} from './naming'
import { buildHtmlDocument } from './pdf-html'
import {
  COMPRESS_PRESETS,
  type CompressPayload,
  type DeletePayload,
  type ExportHtmlPayload,
  type ExtractImagesPayload,
  type ExtractTextPayload,
  type MetadataPatch,
  type MetadataPayload,
  type MergePayload,
  type PageNumberPayload,
  type PageNumberPosition,
  type PdfMetadata,
  type PdfProgress,
  type ReorderPayload,
  type RotatePayload,
  type SplitPayload,
  type WatermarkPayload
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
  | { op: 'watermark'; payload: WatermarkPayload }
  | { op: 'page-numbers'; payload: PageNumberPayload }
  | { op: 'extract-text'; payload: ExtractTextPayload }
  | { op: 'extract-images'; payload: ExtractImagesPayload }
  | { op: 'compress'; payload: CompressPayload }
  | { op: 'export-html'; payload: ExportHtmlPayload }

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
function resolveOutput(desired: string): string {
  const resolved = resolveConflictPath(desired, existsSync)
  if (resolved === null) throw toolError('PT_OUTPUT_WRITE_FAILED', 'conflict-exhausted')
  return resolved
}

/** 目录冲突递增：`dir`、`dir (1)`…（99 次耗尽 → PT_OUTPUT_WRITE_FAILED，M38） */
function resolveOutputDir(desired: string): string {
  if (!existsSync(desired)) return desired
  for (let index = 1; index <= 99; index += 1) {
    const candidate = `${desired} (${index})`
    if (!existsSync(candidate)) return candidate
  }
  throw toolError('PT_OUTPUT_WRITE_FAILED', 'dir-conflict-exhausted')
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

/** 平铺步长相对水印尺寸的倍数（保证 45° 旋转下不重叠） */
const WATERMARK_TILE_RATIO = 1.8

/** #rrggbb → pdf-lib rgb 分量（0..1） */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255
  }
}

/**
 * 绕图片中心旋转时的左下角锚点（pdf-lib 以左下角为旋转中心）
 * @param pageWidth 页宽
 * @param pageHeight 页高
 * @param width 图片宽
 * @param height 图片高
 * @param angle 旋转角度（度）
 */
export function centerImageAnchor(
  pageWidth: number,
  pageHeight: number,
  width: number,
  height: number,
  angle: number
): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    x: pageWidth / 2 - ((width / 2) * cos - (height / 2) * sin),
    y: pageHeight / 2 - ((width / 2) * sin + (height / 2) * cos)
  }
}

/** 页码文本：替换 `{n}` / `{total}` */
export function pageNumberText(format: string, n: number, total: number): string {
  return format.replaceAll('{n}', String(n)).replaceAll('{total}', String(total))
}

/** 页码绘制坐标（左下角为原点） */
export function pageNumberPosition(
  position: PageNumberPosition,
  pageWidth: number,
  pageHeight: number,
  textWidth: number,
  fontSize: number,
  margin: number
): { x: number; y: number } {
  const x = position.endsWith('left')
    ? margin
    : position.endsWith('right')
      ? pageWidth - margin - textWidth
      : (pageWidth - textWidth) / 2
  const y = position.startsWith('top') ? pageHeight - margin - fontSize : margin
  return { x, y }
}

/** 解析水印图片来源：文字为 renderer 预栅格化 PNG，图片读本地 PNG/JPG */
async function loadWatermarkImage(
  doc: PDFDocument,
  payload: WatermarkPayload
): Promise<PDFImage> {
  if (payload.kind === 'text') {
    try {
      return await doc.embedPng(Buffer.from(payload.imageData, 'base64'))
    } catch (err) {
      throw toolError('PT_WATERMARK_INVALID', tail(messageOf(err)) || 'text-raster')
    }
  }
  let bytes: Uint8Array
  try {
    bytes = await readFile(payload.imagePath)
  } catch (err) {
    throw toolError('PT_WATERMARK_INVALID', errnoCode(err) || tail(messageOf(err)))
  }
  try {
    return /\.png$/i.test(payload.imagePath)
      ? await doc.embedPng(bytes)
      : await doc.embedJpg(bytes)
  } catch (err) {
    throw toolError('PT_WATERMARK_INVALID', tail(messageOf(err)) || 'image-embed')
  }
}

/** 水印：文字（PNG base64）或图片按页绘制，可选平铺 */
export async function watermarkPdf(
  payload: WatermarkPayload,
  progress: EmitProgress
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const doc = await loadSource(payload.inputPath)
  const image = await loadWatermarkImage(doc, payload)
  const pageCount = doc.getPageCount()
  const parsed = parsePageList(payload.ranges ?? '', pageCount, { allowEmpty: true })
  if (!parsed.ok) throw rangeFailure(parsed)
  const pages = parsed.value ?? []
  const targets = pages.length === 0 ? doc.getPageIndices().map((index) => index + 1) : pages
  const total = targets.length
  for (const [index, pageNumber] of targets.entries()) {
    const page = doc.getPage(pageNumber - 1)
    if (page === undefined) throw toolError('PT_RANGE_INVALID', String(pageNumber))
    const width = (page.getWidth() * payload.scale) / 100
    const height = width * (image.height / image.width)
    const rotate = degrees(payload.angle)
    if (payload.tile) {
      const pageWidth = page.getWidth()
      const pageHeight = page.getHeight()
      const stepX = width * WATERMARK_TILE_RATIO
      const stepY = height * WATERMARK_TILE_RATIO
      for (let y = -height; y < pageHeight + height; y += stepY) {
        for (let x = -width; x < pageWidth + width; x += stepX) {
          page.drawImage(image, { x, y, width, height, rotate, opacity: payload.opacity })
        }
      }
    } else {
      const { x, y } = centerImageAnchor(
        page.getWidth(),
        page.getHeight(),
        width,
        height,
        payload.angle
      )
      page.drawImage(image, { x, y, width, height, rotate, opacity: payload.opacity })
    }
    progress({
      stage: 'process',
      current: index + 1,
      total,
      message: `已添加水印 ${index + 1}/${total}`
    })
  }
  const outputPath = resolveOutput(watermarkDesiredPath(payload.inputPath))
  progress({ stage: 'write', current: total, total, message: '写出文件…' })
  await writeOutput(outputPath, doc)
  progress({ stage: 'done', current: total, total, message: '完成' })
  return { outputPaths: [outputPath] }
}

/** 页码：从 startPage 起编号（n 从 1 开始），{total} = 文档总页数 */
export async function addPageNumbers(
  payload: PageNumberPayload,
  progress: EmitProgress
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const doc = await loadSource(payload.inputPath)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pageCount = doc.getPageCount()
  const parsed = parsePageList(payload.ranges ?? '', pageCount, { allowEmpty: true })
  if (!parsed.ok) throw rangeFailure(parsed)
  const selected = parsed.value ?? []
  const base = selected.length === 0 ? doc.getPageIndices().map((index) => index + 1) : selected
  const targets = base.filter((pageNumber) => pageNumber >= payload.startPage)
  if (targets.length === 0) throw toolError('PT_PAGE_NUMBER_INVALID', 'no-target-page')
  const color = hexToRgb(payload.color)
  const total = targets.length
  for (const [index, pageNumber] of targets.entries()) {
    const page = doc.getPage(pageNumber - 1)
    if (page === undefined) throw toolError('PT_RANGE_INVALID', String(pageNumber))
    const text = pageNumberText(payload.format, pageNumber - payload.startPage + 1, pageCount)
    const textWidth = font.widthOfTextAtSize(text, payload.fontSize)
    const { x, y } = pageNumberPosition(
      payload.position,
      page.getWidth(),
      page.getHeight(),
      textWidth,
      payload.fontSize,
      payload.margin
    )
    page.drawText(text, {
      x,
      y,
      size: payload.fontSize,
      font,
      color: rgb(color.r, color.g, color.b)
    })
    progress({
      stage: 'process',
      current: index + 1,
      total,
      message: `已添加页码 ${index + 1}/${total}`
    })
  }
  const outputPath = resolveOutput(pageNumbersDesiredPath(payload.inputPath))
  progress({ stage: 'write', current: total, total, message: '写出文件…' })
  await writeOutput(outputPath, doc)
  progress({ stage: 'done', current: total, total, message: '完成' })
  return { outputPaths: [outputPath] }
}

/** 解析目标页：空范围 = 全部页（M38） */
function selectPages(ranges: string | undefined, pageCount: number): number[] {
  const parsed = parsePageList(ranges ?? '', pageCount, { allowEmpty: true })
  if (!parsed.ok) throw rangeFailure(parsed)
  const pages = parsed.value ?? []
  return pages.length === 0 ? Array.from({ length: pageCount }, (_, index) => index + 1) : pages
}

/** 文本提取：逐页重建文本，页前插入分隔行；全文档无文本 → PT_NO_TEXT_LAYER（M38） */
async function extractText(
  payload: ExtractTextPayload,
  progress: EmitProgress
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const opened = await openPdf(payload.inputPath)
  try {
    const targets = selectPages(payload.ranges, opened.pageCount)
    const total = targets.length
    const { pages, hasText } = await extractPdfText(opened.doc, targets)
    if (!hasText) throw toolError('PT_NO_TEXT_LAYER')
    const content = pages
      .map((page) => `===== 第 ${page.pageNumber} 页 =====\n\n${page.text}`)
      .join('\n\n')
    const outputPath = resolveOutput(extractTextDesiredPath(payload.inputPath))
    progress({ stage: 'process', current: total, total, message: '整理文本…' })
    progress({ stage: 'write', current: total, total, message: '写出文件…' })
    try {
      await writeFile(outputPath, `${content}\n`, 'utf8')
    } catch (err) {
      await unlink(outputPath).catch(() => undefined)
      throw toolError('PT_OUTPUT_WRITE_FAILED', errnoCode(err) || tail(messageOf(err)))
    }
    progress({ stage: 'done', current: total, total, message: '完成' })
    return { outputPaths: [outputPath] }
  } finally {
    await opened.doc.cleanup().catch(() => undefined)
  }
}

/** 图片提取：新建 `{基名}_图片` 目录逐张写 PNG；无图/超限给结构化错误（M38） */
async function extractImages(
  payload: ExtractImagesPayload,
  progress: EmitProgress
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const opened = await openPdf(payload.inputPath)
  try {
    const targets = selectPages(payload.ranges, opened.pageCount)
    progress({ stage: 'process', current: 0, total: targets.length, message: '解析图片…' })
    let extracted
    try {
      extracted = await extractPdfImages(opened.doc, targets)
    } catch (err) {
      if (err instanceof ExtractedImageLimitError) throw toolError('PT_TOO_MANY_IMAGES')
      throw toolError('PT_OP_FAILED', tail(messageOf(err)))
    }
    if (extracted.images.length === 0) throw toolError('PT_NO_IMAGES')
    const outputDir = resolveOutputDir(extractImagesDesiredDir(payload.inputPath))
    try {
      await mkdir(outputDir)
    } catch (err) {
      throw toolError('PT_OUTPUT_WRITE_FAILED', errnoCode(err) || tail(messageOf(err)))
    }
    const total = extracted.images.length
    const outputPaths: string[] = []
    for (const [index, image] of extracted.images.entries()) {
      const filePath = join(outputDir, `p${image.pageNumber}-${image.index}.png`)
      try {
        await writeFile(filePath, image.png)
      } catch (err) {
        await rm(outputDir, { recursive: true, force: true }).catch(() => undefined)
        throw toolError('PT_OUTPUT_WRITE_FAILED', errnoCode(err) || tail(messageOf(err)))
      }
      outputPaths.push(filePath)
      progress({
        stage: 'process',
        current: index + 1,
        total,
        message: `写出图片 ${index + 1}/${total}`
      })
    }
    progress({ stage: 'write', current: total, total, message: '写出完成…' })
    progress({ stage: 'done', current: total, total, message: `完成（共 ${total} 张）` })
    return { outputPaths }
  } finally {
    await opened.doc.cleanup().catch(() => undefined)
  }
}

/** 压缩：逐页按档位渲染为 JPEG 并按原页 pt 尺寸重建文档；有损（M38） */
async function compressPdf(
  payload: CompressPayload,
  progress: EmitProgress
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const preset = COMPRESS_PRESETS[payload.level]
  const scale = preset.dpi / 72
  const opened = await openPdf(payload.inputPath)
  try {
    const targets = selectPages(payload.ranges, opened.pageCount)
    const total = targets.length
    const out = await PDFDocument.create()
    for (const [index, pageNumber] of targets.entries()) {
      try {
        const sourcePage = await opened.doc.getPage(pageNumber)
        const viewport = sourcePage.getViewport({ scale: 1 })
        const pageWidth = viewport.width
        const pageHeight = viewport.height
        sourcePage.cleanup()
        const rendered = await renderPageToCanvas(opened.doc, pageNumber, { scale })
        const jpeg = await encodeCanvas(rendered.canvas, 'jpeg', preset.quality)
        const embedded = await out.embedJpg(jpeg)
        const page = out.addPage([pageWidth, pageHeight])
        page.drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight })
      } catch (err) {
        throw toolError('PT_OP_FAILED', tail(messageOf(err)) || `page-${pageNumber}`)
      }
      progress({
        stage: 'process',
        current: index + 1,
        total,
        message: `第 ${index + 1}/${total} 页`
      })
    }
    const outputPath = resolveOutput(compressDesiredPath(payload.inputPath))
    progress({ stage: 'write', current: total, total, message: '写出文件…' })
    await writeOutput(outputPath, out)
    const originalSize = await stat(payload.inputPath)
      .then((info) => info.size)
      .catch(() => 0)
    const newSize = await stat(outputPath)
      .then((info) => info.size)
      .catch(() => 0)
    progress({
      stage: 'done',
      current: total,
      total,
      message: `完成（原 ${formatBytes(originalSize)} → 新 ${formatBytes(newSize)}）`
    })
    return { outputPaths: [outputPath] }
  } finally {
    await opened.doc.cleanup().catch(() => undefined)
  }
}

/** 打开 PDF 供版面抽取：加密 → PT_PDF_NO_TEXT；其他 → PT_OP_FAILED（M63） */
async function openForExport(inputPath: string): Promise<OpenedPdf> {
  try {
    return await openPdf(inputPath)
  } catch (err) {
    const message = messageOf(err)
    // 计划口径（plan §4.63.3）：加密与无文本层统一 PT_PDF_NO_TEXT
    if (/password|encrypt/i.test(message)) throw toolError('PT_PDF_NO_TEXT', tail(message))
    throw toolError('PT_OP_FAILED', tail(message) || errnoCode(err))
  }
}

/** PDF→HTML：抽取版面行 → 结构化 HTML；无文本层/加密 → PT_PDF_NO_TEXT（M63） */
export async function exportHtml(
  payload: ExportHtmlPayload,
  progress: EmitProgress
): Promise<OpResult> {
  progress({ stage: 'load', current: 0, message: '读取 PDF…' })
  const opened = await openForExport(payload.inputPath)
  try {
    const targets = selectPages(payload.ranges, opened.pageCount)
    const total = targets.length
    progress({ stage: 'process', current: 0, total, message: '重建版面…' })
    const { pages, hasText } = await extractPdfLines(opened.doc, targets)
    if (!hasText) throw toolError('PT_PDF_NO_TEXT')
    const html = buildHtmlDocument({ title: basename(payload.inputPath, extname(payload.inputPath)), pages })
    const outputPath = resolveOutput(exportHtmlDesiredPath(payload.inputPath))
    progress({ stage: 'write', current: total, total, message: '写出文件…' })
    try {
      await writeFile(outputPath, html, 'utf8')
    } catch (err) {
      await unlink(outputPath).catch(() => undefined)
      throw toolError('PT_EXPORT_FAILED', errnoCode(err) || tail(messageOf(err)))
    }
    progress({ stage: 'done', current: total, total, message: '完成' })
    return { outputPaths: [outputPath] }
  } finally {
    await opened.doc.cleanup().catch(() => undefined)
  }
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
    case 'watermark':
      return watermarkPdf(request.payload, progress)
    case 'page-numbers':
      return addPageNumbers(request.payload, progress)
    case 'extract-text':
      return extractText(request.payload, progress)
    case 'extract-images':
      return extractImages(request.payload, progress)
    case 'compress':
      return compressPdf(request.payload, progress)
    case 'export-html':
      return exportHtml(request.payload, progress)
  }
}
