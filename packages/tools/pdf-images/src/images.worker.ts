/**
 * @file images.worker.ts 图片 → PDF 任务（worker 线程）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 图片按列表顺序单页嵌入：png/jpg 直嵌，其余格式经 ffmpeg 转 PNG 中间件；
 *              auto 跟随图片尺寸、a4 等比居中留边距；单张失败不中断整批、原子写。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { PDFDocument, type PDFImage } from 'pdf-lib'
import { exposeTask, runProcess, SpawnError, tail, type TaskRunContext } from '@lumin/node-kit'
import { uniqueFileName, type StructuredError } from '@lumin/shared'
import { imageKind, pageLayout, pdfOutputName, toFailure } from './contract'
import { errnoCode, isStructuredError, toolError } from './errors'
import type { ImagesToPdfRequest, ImagesToPdfResult, PdfImagesFailure } from './schema'

/** ffmpeg 单张转码超时 */
export const FFMPEG_TIMEOUT_MS = 120_000

/** worker 可注入依赖（测试注入假 ffmpeg；生产用 node-kit runProcess） */
export interface ImagesWorkerDeps {
  runProcess(options: Parameters<typeof runProcess>[0]): ReturnType<typeof runProcess>
}

const defaultDeps: ImagesWorkerDeps = { runProcess }

/** 读图失败分类（ENOENT → 输入无效；其余按损坏处理） */
function classifyReadError(err: unknown): StructuredError {
  const code = errnoCode(err)
  if (code === 'ENOENT') return toolError('PI_INPUT_INVALID', code)
  return toolError('PI_IMAGE_CORRUPT', code !== '' ? code : tail(String(err)))
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

/** ffmpeg 转 PNG（非 png/jpg 输入的中间步骤） */
async function convertToPng(
  deps: ImagesWorkerDeps,
  ffmpegPath: string,
  inputPath: string,
  outputPath: string
): Promise<void> {
  let result: Awaited<ReturnType<typeof runProcess>>
  try {
    result = await deps.runProcess({
      command: ffmpegPath,
      args: ['-y', '-i', inputPath, '-frames:v', '1', outputPath],
      timeoutMs: FFMPEG_TIMEOUT_MS,
      maxOutputChars: 8192
    })
  } catch (err) {
    if (err instanceof SpawnError) throw toolError('PI_ENGINE_MISSING', err.command)
    throw err
  }
  if (result.timedOut) throw toolError('PI_IMAGE_CORRUPT', '转码超时')
  if (result.code !== 0) throw toolError('PI_IMAGE_CORRUPT', tail(result.stderr))
}

/**
 * 读取并嵌入单张图片（png/jpg 直嵌，其余先转码）
 * @param pdf 目标文档
 * @param inputPath 图片路径
 * @param ffmpegPath 引擎路径（仅 other 分支使用）
 * @param tmpDir 中间文件目录
 * @param index 输入序号（中间文件唯一名）
 */
async function embedImage(
  deps: ImagesWorkerDeps,
  pdf: PDFDocument,
  inputPath: string,
  ffmpegPath: string,
  tmpDir: string,
  index: number
): Promise<PDFImage> {
  const kind = imageKind(inputPath)
  if (kind === 'other') {
    const pngPath = join(tmpDir, `${index}.png`)
    await convertToPng(deps, ffmpegPath, inputPath, pngPath)
    const bytes = await readFile(pngPath)
    try {
      return await pdf.embedPng(bytes)
    } catch (err) {
      throw toolError('PI_IMAGE_CORRUPT', tail(err instanceof Error ? err.message : String(err)))
    }
  }
  let bytes: Buffer
  try {
    bytes = await readFile(inputPath)
  } catch (err) {
    throw classifyReadError(err)
  }
  try {
    return kind === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
  } catch (err) {
    throw toolError('PI_IMAGE_CORRUPT', tail(err instanceof Error ? err.message : String(err)))
  }
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
 * 图片→PDF 主流程（导出便于单测；exposeTask 在 worker 环境注册）
 * @param payload 请求（node 侧已展开列表与输出目录）
 * @param ctx worker 上下文（emit 进度）
 */
export async function runImagesToPdf(
  payload: ImagesToPdfRequest,
  ctx: TaskRunContext,
  deps: ImagesWorkerDeps = defaultDeps
): Promise<ImagesToPdfResult> {
  const { inputPaths, pageSize, orientation, marginMm, outputName, outputDir, ffmpegPath } = payload

  try {
    await mkdir(outputDir, { recursive: true })
  } catch (err) {
    throw classifyWriteError(err)
  }

  // worker 线程共享主进程 pid，并发任务同毫秒启动时 Date.now() 会碰撞导致共用临时目录，
  // 因此必须用 UUID 保证每任务独立（否则一方 finally 清理会打断另一方 → EPERM）
  const tmpDir = join(tmpdir(), `lumin-pdf-images-${randomUUID()}`)
  const pdf = await PDFDocument.create()
  const failures: PdfImagesFailure[] = []
  let pages = 0
  try {
    await mkdir(tmpDir, { recursive: true })
    for (const [index, inputPath] of inputPaths.entries()) {
      const label = basename(inputPath)
      try {
        const image = await embedImage(deps, pdf, inputPath, ffmpegPath, tmpDir, index)
        const layout = pageLayout(image.width, image.height, { pageSize, orientation, marginMm })
        if (layout === null) throw toolError('PI_PAGE_SIZE_INVALID', `${label} 尺寸无效`)
        const page = pdf.addPage([layout.pageWidth, layout.pageHeight])
        page.drawImage(image, {
          x: layout.x,
          y: layout.y,
          width: layout.width,
          height: layout.height
        })
        pages += 1
      } catch (err) {
        const structured = isStructuredError(err)
          ? err
          : toolError('PI_CONVERT_FAILED', tail(err instanceof Error ? err.message : String(err)))
        failures.push(toFailure(label, structured))
      }
      ctx.emit({
        kind: 'progress',
        current: index + 1,
        total: inputPaths.length,
        stage: 'embed',
        message: label
      })
    }
  } finally {
    // 临时目录清理失败不应影响任务结果（如杀毒软件短暂占用）
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }

  if (pages === 0) {
    const first = failures[0]
    if (first !== undefined) {
      throw first.detail === undefined || first.detail === ''
        ? { code: first.code, message: first.message }
        : { code: first.code, message: first.message, detail: first.detail }
    }
    throw toolError('PI_CONVERT_FAILED')
  }

  const firstInput = inputPaths[0]
  if (firstInput === undefined) throw toolError('PI_CONVERT_FAILED')

  const name = uniqueFileName(
    await existingNames(outputDir),
    basename(pdfOutputName(firstInput, outputName))
  )
  const finalPath = join(outputDir, name)
  const tmpPath = `${finalPath}.tmp`
  try {
    const bytes = await pdf.save()
    await writeFile(tmpPath, bytes)
    await rename(tmpPath, finalPath)
  } catch (err) {
    await rm(tmpPath, { force: true })
    throw classifyWriteError(err)
  }

  return { output: finalPath, pages, failures }
}

exposeTask<ImagesToPdfRequest, ImagesToPdfResult>(runImagesToPdf)
