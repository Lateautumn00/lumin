/**
 * @file ocr.worker 单测（假 ocr-kit：验证进度上抛与结果/错误透传）
 * @author cuilanchao
 * @date 2026-11-19
 * @description exposeTask 在非 worker 线程为空操作，可直接 import 处理器。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderedPage } from '@lumin/ocr-kit'
import type { StructuredError, TaskUpdate } from '@lumin/shared'
import { handleOcrTextTask } from './ocr.worker'

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  createEngine: vi.fn()
}))

vi.mock('@lumin/ocr-kit', () => ({
  renderOcrInput: mocks.render,
  createOcrEngine: mocks.createEngine,
  sortReadingOrder: (lines: unknown[]) => lines
}))

function fakePage(): RenderedPage {
  return {
    pageNumber: 1,
    width: 120,
    height: 60,
    image: { data: new Uint8ClampedArray(4), width: 1, height: 1 }
  }
}

beforeEach(() => {
  mocks.render.mockReset()
  mocks.createEngine.mockReset()
})

describe('handleOcrTextTask', () => {
  it('进度以 kind:progress 上抛，返回识别结果', async () => {
    mocks.render.mockResolvedValue([fakePage()])
    mocks.createEngine.mockResolvedValue({
      detectLines: async () => [{ text: '你好', x: 0.1, y: 0.2, width: 0.3, height: 0.1 }]
    })
    const emit = vi.fn<(update: TaskUpdate) => void>()
    const result = await handleOcrTextTask(
      { inputPath: 'C:/a.png', binariesDir: 'C:/models' },
      { emit }
    )
    expect(result.width).toBe(120)
    expect(result.height).toBe(60)
    expect(result.lines).toHaveLength(1)
    const first = emit.mock.calls[0]?.[0]
    expect(first?.kind).toBe('progress')
    expect(first?.kind === 'progress' ? first.stage : undefined).toBe('render')
  })

  it('未识别到文字 → OCR_NO_TEXT', async () => {
    mocks.render.mockResolvedValue([fakePage()])
    mocks.createEngine.mockResolvedValue({ detectLines: async () => [] })
    const emit = vi.fn<(update: TaskUpdate) => void>()
    await expect(
      handleOcrTextTask({ inputPath: 'C:/a.png', binariesDir: 'C:/models' }, { emit })
    ).rejects.toMatchObject({ code: 'OCR_NO_TEXT' })
  })

  it('非结构化异常 → OCR_FAILED（保留 detail）', async () => {
    mocks.render.mockRejectedValue(new Error('decode boom'))
    const emit = vi.fn<(update: TaskUpdate) => void>()
    try {
      await handleOcrTextTask({ inputPath: 'C:/a.png', binariesDir: 'C:/models' }, { emit })
      expect.unreachable('应当抛出结构化错误')
    } catch (err) {
      const structured = err as StructuredError
      expect(structured.code).toBe('OCR_FAILED')
      expect(structured.detail).toContain('decode boom')
    }
  })
})
