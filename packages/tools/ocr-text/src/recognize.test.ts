/**
 * @file 批量识别编排单测（假引擎/渲染，不触碰真实 OCR）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 引擎单次创建、逐项失败不中断、结果同序、PDF 多页拼接、空结果/无文字/异常归一与进度阶段
 */
import { describe, expect, it, vi } from 'vitest'
import type { OcrEngine, OcrLine, RenderedPage } from '@lumin/ocr-kit'
import type { RgbaImage } from '@lumin/ocr-kit'
import { runBatch, type BatchDeps } from './recognize'

const IMAGE: RgbaImage = { data: new Uint8ClampedArray(0), width: 100, height: 50 }

function page(pageNumber = 1): RenderedPage {
  return { pageNumber, width: 100, height: 50, image: IMAGE }
}

function ocrLine(text: string): OcrLine {
  return { text, x: 0.1, y: 0.1, width: 0.2, height: 0.05 }
}

/** 可注入假件：render 按路径映射，detect 返回固定行 */
function deps(overrides: Partial<BatchDeps> = {}): BatchDeps {
  return {
    render: vi.fn(async () => [page()]),
    createEngine: vi.fn(async (): Promise<OcrEngine> => ({
      detectLines: async () => [ocrLine('第一行'), ocrLine('第二行')]
    })),
    ...overrides
  }
}

describe('runBatch', () => {
  it('多张图片只创建一个引擎，结果与输入同序并拼接文本', async () => {
    const batchDeps = deps()
    const result = await runBatch(
      { inputPaths: ['C:\\a.png', 'C:\\b.png'], binariesDir: 'C:\\ocr' },
      batchDeps,
      () => undefined
    )
    expect(batchDeps.createEngine).toHaveBeenCalledTimes(1)
    expect(batchDeps.createEngine).toHaveBeenCalledWith('C:\\ocr')
    expect(result.items).toEqual([
      {
        status: 'done',
        inputPath: 'C:\\a.png',
        width: 100,
        height: 50,
        pageCount: 1,
        text: '第一行\n第二行'
      },
      {
        status: 'done',
        inputPath: 'C:\\b.png',
        width: 100,
        height: 50,
        pageCount: 1,
        text: '第一行\n第二行'
      }
    ])
  })

  it('PDF 多页逐页识别：按页分段拼接、pageCount 为页数、渲染透传 maxPages', async () => {
    const render = vi.fn(async () => [page(1), page(2), page(3)])
    const detectLines = vi.fn(async () => [ocrLine('第几页')])
    const batchDeps = deps({
      render,
      createEngine: vi.fn(async (): Promise<OcrEngine> => ({ detectLines }))
    })
    const progress: string[] = []
    const result = await runBatch(
      { inputPaths: ['C:\\扫描 文件.PDF'], binariesDir: 'C:\\ocr' },
      batchDeps,
      (update) => progress.push(update.message)
    )

    expect(render).toHaveBeenCalledWith(
      'C:\\扫描 文件.PDF',
      expect.objectContaining({ maxPages: 30, onPage: expect.any(Function) })
    )
    expect(detectLines).toHaveBeenCalledTimes(3)
    expect(result.items[0]).toEqual({
      status: 'done',
      inputPath: 'C:\\扫描 文件.PDF',
      width: 100,
      height: 50,
      pageCount: 3,
      text: [
        '===== 第 1 页 =====\n第几页',
        '===== 第 2 页 =====\n第几页',
        '===== 第 3 页 =====\n第几页'
      ].join('\n\n')
    })
    expect(progress.some((message) => message.includes('第 2/3 页'))).toBe(true)
  })

  it('PDF 多页中空白页不产生空分段；全部空白归 OCR_NO_TEXT', async () => {
    let call = 0
    const mixed = deps({
      render: vi.fn(async () => [page(1), page(2)]),
      createEngine: vi.fn(async (): Promise<OcrEngine> => ({
        detectLines: async () => {
          call += 1
          return call === 1 ? [] : [ocrLine('第二页文字')]
        }
      }))
    })
    const mixedResult = await runBatch(
      { inputPaths: ['C:\\a.pdf'], binariesDir: 'C:\\ocr' },
      mixed,
      () => undefined
    )
    expect(mixedResult.items[0]).toEqual({
      status: 'done',
      inputPath: 'C:\\a.pdf',
      width: 100,
      height: 50,
      pageCount: 2,
      text: '===== 第 2 页 =====\n第二页文字'
    })

    const allBlank = deps({
      render: vi.fn(async () => [page(1), page(2)]),
      createEngine: vi.fn(async (): Promise<OcrEngine> => ({ detectLines: async () => [] }))
    })
    const blankResult = await runBatch(
      { inputPaths: ['C:\\b.pdf'], binariesDir: 'C:\\ocr' },
      allBlank,
      () => undefined
    )
    expect(blankResult.items[0]).toMatchObject({ error: { code: 'OCR_NO_TEXT' } })
  })

  it('单张渲染失败不中断整批，失败项带结构化错误', async () => {
    const batchDeps = deps({
      render: vi.fn(async (path: string) => {
        if (path.endsWith('bad.png')) throw new Error('decode failed')
        return [page()]
      })
    })
    const result = await runBatch(
      { inputPaths: ['C:\\bad.png', 'C:\\ok.png'], binariesDir: 'C:\\ocr' },
      batchDeps,
      () => undefined
    )
    expect(result.items[0]).toMatchObject({
      status: 'failed',
      error: { code: 'OCR_FAILED', detail: 'decode failed' }
    })
    expect(result.items[1]).toMatchObject({ status: 'done' })
  })

  it('渲染结果为空 → OCR_INPUT_INVALID；无文字 → OCR_NO_TEXT；结构化错误透传', async () => {
    const empty = deps({ render: vi.fn(async () => []) })
    const emptyResult = await runBatch(
      { inputPaths: ['C:\\a.png'], binariesDir: 'C:\\ocr' },
      empty,
      () => undefined
    )
    expect(emptyResult.items[0]).toMatchObject({ error: { code: 'OCR_INPUT_INVALID' } })

    const noText = deps({
      createEngine: vi.fn(async (): Promise<OcrEngine> => ({ detectLines: async () => [] }))
    })
    const noTextResult = await runBatch(
      { inputPaths: ['C:\\a.png'], binariesDir: 'C:\\ocr' },
      noText,
      () => undefined
    )
    expect(noTextResult.items[0]).toMatchObject({ error: { code: 'OCR_NO_TEXT' } })

    const structured = deps({
      createEngine: vi.fn(async (): Promise<OcrEngine> => ({
        detectLines: async () => {
          throw { code: 'OCR_FAILED', message: '推理失败' }
        }
      }))
    })
    const structuredResult = await runBatch(
      { inputPaths: ['C:\\a.png'], binariesDir: 'C:\\ocr' },
      structured,
      () => undefined
    )
    expect(structuredResult.items[0]).toMatchObject({
      error: { code: 'OCR_FAILED', message: '推理失败' }
    })
  })

  it('引擎创建失败作为任务级错误向上抛出', async () => {
    const batchDeps = deps({
      createEngine: vi.fn(async (): Promise<OcrEngine> => {
        throw { code: 'MODEL_MISSING', message: '模型缺失' }
      })
    })
    await expect(
      runBatch({ inputPaths: ['C:\\a.png'], binariesDir: 'C:\\ocr' }, batchDeps, () => undefined)
    ).rejects.toMatchObject({ code: 'MODEL_MISSING' })
  })

  it('进度覆盖 render/detect 阶段并以完成态收尾', async () => {
    const progress: { stage: string; current: number; total: number }[] = []
    await runBatch(
      { inputPaths: ['C:\\a.png', 'C:\\b.png'], binariesDir: 'C:\\ocr' },
      deps(),
      (update) => progress.push(update)
    )
    expect(progress.map((item) => item.stage)).toEqual([
      'render',
      'detect',
      'render',
      'detect',
      'detect'
    ])
    expect(progress[progress.length - 1]).toMatchObject({ current: 2, total: 2 })
  })

  it('空文本行（仅空白）归 OCR_NO_TEXT', async () => {
    const blank = deps({
      createEngine: vi.fn(async (): Promise<OcrEngine> => ({
        detectLines: async () => [ocrLine('   ')]
      }))
    })
    const result = await runBatch(
      { inputPaths: ['C:\\a.png'], binariesDir: 'C:\\ocr' },
      blank,
      () => undefined
    )
    expect(result.items[0]).toMatchObject({ error: { code: 'OCR_NO_TEXT' } })
  })
})
