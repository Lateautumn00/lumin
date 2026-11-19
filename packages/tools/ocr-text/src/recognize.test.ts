/**
 * @file recognize 编排单测（假渲染/引擎，不触碰真实 OCR）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 正常顺序、进度阶段、空结果、结构化透传、非结构化包装
 */
import { describe, expect, it, vi } from 'vitest'
import type { OcrEngine, RenderedPage } from '@lumin/ocr-kit'
import type { StructuredError } from '@lumin/shared'
import { toolError } from './errors'
import { runRecognize, type RecognizeDeps, type RecognizeProgress } from './recognize'
import type { OcrTextLine } from './schema'

/** 1×1 透明页（仅占位，识别由假引擎返回） */
function fakePage(): RenderedPage {
  return {
    pageNumber: 1,
    width: 100,
    height: 50,
    image: { data: new Uint8ClampedArray(4), width: 1, height: 1 }
  }
}

function line(text: string, x: number, y: number): OcrTextLine {
  return { text, x, y, width: 0.2, height: 0.05 }
}

/** 构造依赖；render/engine 行为可按用例覆盖 */
function createDeps(overrides: Partial<RecognizeDeps> = {}): RecognizeDeps {
  return {
    render: async () => [fakePage()],
    createEngine: async (): Promise<OcrEngine> => ({
      detectLines: async () => [line('右', 0.6, 0.1), line('左', 0.1, 0.11)]
    }),
    ...overrides
  }
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<StructuredError> {
  try {
    await promise
  } catch (err) {
    const structured = err as StructuredError
    expect(structured.code).toBe(code)
    return structured
  }
  throw new Error(`期望抛出 ${code}，实际成功`)
}

describe('runRecognize', () => {
  it('按阅读顺序返回并上抛 render/detect 进度', async () => {
    const progress: RecognizeProgress[] = []
    const result = await runRecognize(
      { inputPath: 'C:\\图片 目录\\a.png', binariesDir: 'C:\\bin\\ocr' },
      createDeps(),
      (update) => progress.push(update)
    )

    expect(result.width).toBe(100)
    expect(result.height).toBe(50)
    expect(result.lines.map((item) => item.text)).toEqual(['左', '右'])
    expect(progress[0]?.stage).toBe('render')
    expect(progress.some((item) => item.stage === 'detect')).toBe(true)
    expect(progress[progress.length - 1]?.message).toBe('识别完成')
  })

  it('render 的 onPage 回调转换为 render 进度', async () => {
    const progress: RecognizeProgress[] = []
    const deps = createDeps({
      render: async (_path, options) => {
        options?.onPage?.(1, 1)
        return [fakePage()]
      }
    })
    await runRecognize({ inputPath: 'a.png', binariesDir: 'x' }, deps, (update) =>
      progress.push(update)
    )
    expect(progress.some((item) => item.stage === 'render' && item.current === 1)).toBe(true)
  })

  it('零识别行归 OCR_NO_TEXT', async () => {
    const deps = createDeps({
      createEngine: async () => ({ detectLines: async () => [] })
    })
    await expectCode(runRecognize({ inputPath: 'a.png', binariesDir: 'x' }, deps, () => undefined), 'OCR_NO_TEXT')
  })

  it('渲染结果为空归 OCR_INPUT_INVALID', async () => {
    const deps = createDeps({ render: async () => [] })
    await expectCode(runRecognize({ inputPath: 'a.png', binariesDir: 'x' }, deps, () => undefined), 'OCR_INPUT_INVALID')
  })

  it('结构化错误原样透传', async () => {
    const deps = createDeps({
      createEngine: async () => {
        throw toolError('MODEL_MISSING', 'det: ENOENT')
      }
    })
    const error = await expectCode(
      runRecognize({ inputPath: 'a.png', binariesDir: 'x' }, deps, () => undefined),
      'MODEL_MISSING'
    )
    expect(error.detail).toBe('det: ENOENT')
  })

  it('非结构化异常包 OCR_FAILED 并带尾部细节', async () => {
    const deps = createDeps({
      createEngine: async () => {
        throw new Error('native binding missing')
      }
    })
    const error = await expectCode(
      runRecognize({ inputPath: 'a.png', binariesDir: 'x' }, deps, () => undefined),
      'OCR_FAILED'
    )
    expect(error.detail).toContain('native binding missing')
  })

  it('抛出非 Error 值同样包 OCR_FAILED（字符串化细节）', async () => {
    const boom: unknown = 'string boom'
    const deps = createDeps({
      createEngine: async () => {
        throw boom
      }
    })
    const error = await expectCode(
      runRecognize({ inputPath: 'a.png', binariesDir: 'x' }, deps, () => undefined),
      'OCR_FAILED'
    )
    expect(error.detail).toContain('string boom')
  })

  it('识别引擎抛错同样归 OCR_FAILED', async () => {
    const detectLines = vi.fn(async () => {
      throw new Error('ort failed')
    })
    const deps = createDeps({ createEngine: async () => ({ detectLines }) })
    await expectCode(runRecognize({ inputPath: 'a.png', binariesDir: 'x' }, deps, () => undefined), 'OCR_FAILED')
    expect(detectLines).toHaveBeenCalledTimes(1)
  })
})
