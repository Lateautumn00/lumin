/**
 * @file 批量识别编排单测（假引擎/渲染，不触碰真实 OCR）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 引擎单次创建、逐张失败不中断、结果同序、空结果/无文字/异常归一与进度阶段
 */
import { describe, expect, it, vi } from 'vitest'
import type { OcrEngine, OcrLine, RenderedPage } from '@lumin/ocr-kit'
import type { RgbaImage } from '@lumin/ocr-kit'
import { runBatch, type BatchDeps } from './recognize'

const IMAGE: RgbaImage = { data: new Uint8ClampedArray(0), width: 100, height: 50 }

function page(): RenderedPage {
  return { pageNumber: 1, width: 100, height: 50, image: IMAGE }
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
      { status: 'done', inputPath: 'C:\\a.png', width: 100, height: 50, text: '第一行\n第二行' },
      { status: 'done', inputPath: 'C:\\b.png', width: 100, height: 50, text: '第一行\n第二行' }
    ])
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
