/**
 * @file 批量 OCR 编排（worker 内执行；依赖可注入供单测）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 引擎只创建一次 → 逐张 render + detectLines；单张失败不中断整批，
 *              结果与输入同序；模型缺失等任务级错误向上抛出。
 */
import { tail } from '@lumin/node-kit'
import type { OcrEngine, RenderedPage, RenderOptions } from '@lumin/ocr-kit'
import { composeText, sortReadingOrder } from '@lumin/ocr-kit'
import { isStructuredError, type StructuredError } from '@lumin/shared'
import { toolError } from './errors'
import { MAX_PDF_PAGES, type BatchItemResult, type RecognizeResult } from './schema'

/** worker 入参（binariesDir 由主进程预检后注入，renderer 不可指定） */
export interface RecognizeRequest {
  inputPaths: string[]
  binariesDir: string
}

/** 可注入依赖（生产 = ocr-kit 真实实现） */
export interface BatchDeps {
  render(inputPath: string, options?: RenderOptions): Promise<RenderedPage[]>
  createEngine(ocrDir: string): Promise<OcrEngine>
}

/** 进度更新（worker 转 TaskUpdate 上抛） */
export interface BatchProgress {
  stage: 'render' | 'detect'
  current: number
  total: number
  message: string
}

/** 单张失败归一：结构化错误透传，其余包 OCR_FAILED */
function normalizeItemError(err: unknown): StructuredError {
  if (isStructuredError(err)) return err
  return toolError('OCR_FAILED', tail(err instanceof Error ? err.message : String(err)))
}

/**
 * 执行批量识别。
 * @param request 输入路径列表 + 模型目录
 * @param deps 渲染/引擎依赖
 * @param emit 进度回调
 * @throws 任务级结构化错误（模型缺失 / 引擎初始化失败）
 */
export async function runBatch(
  request: RecognizeRequest,
  deps: BatchDeps,
  emit: (progress: BatchProgress) => void
): Promise<RecognizeResult> {
  const total = request.inputPaths.length
  const engine = await deps.createEngine(request.binariesDir)
  const items: BatchItemResult[] = []

  for (let index = 0; index < total; index += 1) {
    const inputPath = request.inputPaths[index]
    if (inputPath === undefined) continue
    const label = `${index + 1}/${total}`
    try {
      emit({ stage: 'render', current: index, total, message: `读取第 ${label} 个…` })
      const pages = await deps.render(inputPath, {
        maxPages: MAX_PDF_PAGES,
        onPage: (done, pageTotal) =>
          emit({
            stage: 'render',
            current: index,
            total,
            message: `读取第 ${label} 个（${done}/${pageTotal} 页）…`
          })
      })
      const first = pages[0]
      if (first === undefined) throw toolError('OCR_INPUT_INVALID', '渲染结果为空')

      const pageTexts: { pageNumber: number; text: string }[] = []
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const page = pages[pageIndex]
        if (page === undefined) continue
        emit({
          stage: 'detect',
          current: index,
          total,
          message:
            pages.length > 1
              ? `识别第 ${label} 个 · 第 ${pageIndex + 1}/${pages.length} 页…`
              : `识别第 ${label} 个…`
        })
        const lines = await engine.detectLines(page.image)
        pageTexts.push({
          pageNumber: page.pageNumber,
          text: composeText(sortReadingOrder(lines)).trim()
        })
      }

      const nonEmpty = pageTexts.filter((item) => item.text !== '')
      if (nonEmpty.length === 0) throw toolError('OCR_NO_TEXT')
      const text =
        pages.length > 1
          ? nonEmpty
              .map((item) => `===== 第 ${item.pageNumber} 页 =====\n${item.text}`)
              .join('\n\n')
          : (nonEmpty[0]?.text ?? '')

      items.push({
        status: 'done',
        inputPath,
        width: first.width,
        height: first.height,
        pageCount: pages.length,
        text
      })
    } catch (err) {
      items.push({ status: 'failed', inputPath, error: normalizeItemError(err) })
    }
  }

  emit({ stage: 'detect', current: total, total, message: '识别完成' })
  return { items }
}
