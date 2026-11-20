/**
 * @file OCR 识别编排（worker 内执行；依赖可注入供单测）
 * @author cuilanchao
 * @date 2026-11-19
 * @description render 单图 → 创建引擎 → 行识别 → 阅读顺序重排；结构化错误透传，
 *              非结构化异常统一包 OCR_FAILED。
 */
import { tail } from '@lumin/node-kit'
import type { OcrEngine, RenderedPage } from '@lumin/ocr-kit'
import { sortReadingOrder } from '@lumin/ocr-kit'
import { isStructuredError } from '@lumin/shared'
import { toolError } from './errors'
import type { OcrTextLine, RecognizeResult } from './schema'

/** worker 入参（binariesDir 由主进程预检后注入，renderer 不可指定） */
export interface RecognizeRequest {
  inputPath: string
  binariesDir: string
}

/** 可注入依赖（生产 = ocr-kit 真实实现） */
export interface RecognizeDeps {
  render(
    inputPath: string,
    options?: { onPage?: (done: number, total: number) => void }
  ): Promise<RenderedPage[]>
  createEngine(ocrDir: string): Promise<OcrEngine>
}

/** 进度更新（worker 转 TaskUpdate 上抛） */
export interface RecognizeProgress {
  stage: 'render' | 'detect'
  current: number
  total: number
  message: string
}

/**
 * 执行单图识别。
 * @param request 输入路径 + 模型目录
 * @param deps 渲染/引擎依赖
 * @param emit 进度回调
 * @throws 结构化错误（OCR_NO_TEXT / OCR_FAILED / 渲染类错误）
 */
export async function runRecognize(
  request: RecognizeRequest,
  deps: RecognizeDeps,
  emit: (progress: RecognizeProgress) => void
): Promise<RecognizeResult> {
  try {
    emit({ stage: 'render', current: 0, total: 1, message: '读取图片…' })
    const pages = await deps.render(request.inputPath, {
      onPage: (done, total) => {
        emit({ stage: 'render', current: done, total: Math.max(total, 1), message: '读取图片…' })
      }
    })
    const page = pages[0]
    if (page === undefined) throw toolError('OCR_INPUT_INVALID', '渲染结果为空')

    emit({ stage: 'detect', current: 0, total: 1, message: '识别文字…' })
    const engine = await deps.createEngine(request.binariesDir)
    const lines: OcrTextLine[] = await engine.detectLines(page.image)
    const ordered = sortReadingOrder(lines)
    if (ordered.length === 0) throw toolError('OCR_NO_TEXT')

    emit({ stage: 'detect', current: 1, total: 1, message: '识别完成' })
    return { width: page.width, height: page.height, lines: ordered }
  } catch (err) {
    if (isStructuredError(err)) throw err
    throw toolError('OCR_FAILED', tail(err instanceof Error ? err.message : String(err)))
  }
}
