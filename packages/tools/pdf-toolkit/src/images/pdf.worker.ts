/**
 * @file pdf.worker.ts PDF → 图片任务（worker 线程）
 * @author cuilanchao
 * @date 2026-11-19
 * @description pdfjs 逐页渲染 → PNG/JPG 落盘：范围解析（空=全部页）、DPI→倍率、
 *              白底渲染、冲突重名自动递增、单页失败不中断整批、原子写（.tmp + rename）。
 */
import { readdirSync } from 'node:fs'
import { rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { exposeTask, type TaskRunContext } from '@lumin/node-kit'
import { encodeCanvas, openPdf, renderPageToCanvas } from '@lumin/node-kit/pdf'
import { classifyPrecheckError, tail } from '@lumin/node-kit'
import { parsePageList, uniqueFileName, type StructuredError } from '@lumin/shared'
import { dpiToScale, outputImageName, toFailure } from './contract'
import { errnoCode, isStructuredError, toolError } from './errors'
import type { PdfImagesFailure, PdfToImagesRequest, PdfToImagesResult } from './schema'

/** 打开 PDF 失败分类（errno 优先，其次 pdfjs 异常名） */
function classifyOpenError(err: unknown): StructuredError {
  const kind = classifyPrecheckError(err)
  const detail = errnoCode(err)
  if (kind === 'locked') return toolError('PI_PDF_LOCKED', detail)
  if (kind === 'not-found') return toolError('PI_INPUT_INVALID', 'ENOENT')
  const name = err instanceof Error ? err.name : ''
  const message = tail(err instanceof Error ? err.message : String(err))
  if (name === 'PasswordException') return toolError('PI_PDF_ENCRYPTED', message)
  return toolError('PI_PDF_CORRUPT', message || detail)
}

/** 写盘失败分类：空间/权限类归输出目录，其余归转换失败 */
function classifyWriteError(err: unknown): StructuredError {
  const code = errnoCode(err)
  if (
    code === 'ENOSPC' ||
    code === 'EROFS' ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'ENOTDIR' ||
    code === 'EEXIST'
  ) {
    return toolError('PI_OUTPUT_DIR_INVALID', code)
  }
  return toolError('PI_CONVERT_FAILED', code !== '' ? code : tail(String(err)))
}

/** 读取输出目录已占用文件名（不存在时返回空集） */
function existingNames(outputDir: string): Set<string> {
  try {
    return new Set(readdirSync(outputDir).map((name) => name.toLowerCase()))
  } catch {
    return new Set()
  }
}

/**
 * PDF→图片主流程（导出便于单测；exposeTask 在 worker 环境注册）
 * @param payload 请求（node 侧已解析并解析输出目录）
 * @param ctx worker 上下文（emit 进度）
 */
export async function runPdfToImages(
  payload: PdfToImagesRequest,
  ctx: TaskRunContext
): Promise<PdfToImagesResult> {
  const { inputPath, ranges, format, dpi, outputDir } = payload

  let opened: Awaited<ReturnType<typeof openPdf>>
  try {
    opened = await openPdf(inputPath)
  } catch (err) {
    throw classifyOpenError(err)
  }

  const failures: PdfImagesFailure[] = []
  const outputs: string[] = []
  try {
    const parsed = parsePageList(ranges, opened.pageCount, { allowEmpty: true })
    if (!parsed.ok) {
      throw toolError('PI_RANGE_INVALID', parsed.reason === 'overlap' ? 'overlap' : parsed.token)
    }
    const wanted = parsed.value ?? Array.from({ length: opened.pageCount }, (_, index) => index + 1)
    const scale = dpiToScale(dpi)
    const existing = existingNames(outputDir)

    for (const [index, pageNumber] of wanted.entries()) {
      const candidate = basename(outputImageName(inputPath, pageNumber, format))
      try {
        const rendered = await renderPageToCanvas(opened.doc, pageNumber, { scale })
        const bytes = await encodeCanvas(rendered.canvas, format)
        const name = uniqueFileName(existing, candidate)
        existing.add(name.toLowerCase())
        const finalPath = join(outputDir, name)
        const tmpPath = `${finalPath}.tmp`
        try {
          await writeFile(tmpPath, bytes)
          await rename(tmpPath, finalPath)
        } catch (err) {
          await rm(tmpPath, { force: true })
          throw classifyWriteError(err)
        }
        outputs.push(finalPath)
      } catch (err) {
        failures.push(toFailure(candidate, isStructuredError(err) ? err : classifyOpenError(err)))
      }
      ctx.emit({
        kind: 'progress',
        current: index + 1,
        total: wanted.length,
        stage: 'render',
        message: candidate
      })
    }
  } finally {
    await opened.doc.cleanup()
  }

  if (outputs.length === 0 && failures.length > 0) {
    const first = failures[0]
    if (first !== undefined) {
      throw first.detail === undefined || first.detail === ''
        ? { code: first.code, message: first.message }
        : { code: first.code, message: first.message, detail: first.detail }
    }
  }
  return { outputs, pages: outputs.length, outputDir, failures }
}

exposeTask<PdfToImagesRequest, PdfToImagesResult>(runPdfToImages)
