/**
 * @file batch.worker 单测（假 ocr-kit：验证进度上抛与逐张结果/错误透传）
 * @author cuilanchao
 * @date 2026-11-20
 * @description exposeTask 在非 worker 线程为空操作，可直接 import 处理器。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderedPage } from '@lumin/ocr-kit'
import type { TaskUpdate } from '@lumin/shared'
import { handleBatchOcrTask } from './batch.worker'

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  createEngine: vi.fn()
}))

vi.mock('@lumin/ocr-kit', () => ({
  renderOcrInput: mocks.render,
  createOcrEngine: mocks.createEngine,
  sortReadingOrder: (lines: unknown[]) => lines,
  composeText: (lines: { text: string }[]) => lines.map((line) => line.text).join('\n')
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

describe('handleBatchOcrTask', () => {
  it('进度以 kind:progress 上抛，返回逐张结果', async () => {
    mocks.render.mockResolvedValue([fakePage()])
    mocks.createEngine.mockResolvedValue({
      detectLines: async () => [{ text: '你好', x: 0.1, y: 0.2, width: 0.3, height: 0.1 }]
    })
    const emit = vi.fn<(update: TaskUpdate) => void>()
    const result = await handleBatchOcrTask(
      { inputPaths: ['C:/a.png', 'C:/b.png'], binariesDir: 'C:/models' },
      { emit }
    )
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ status: 'done', width: 120, height: 60, text: '你好' })
    const first = emit.mock.calls[0]?.[0]
    expect(first?.kind).toBe('progress')
    expect(first?.kind === 'progress' ? first.stage : undefined).toBe('render')
  })

  it('单张渲染失败保留为失败项，其余继续', async () => {
    mocks.render.mockImplementation(async (path: string) => {
      if (path.endsWith('bad.png')) throw new Error('decode boom')
      return [fakePage()]
    })
    mocks.createEngine.mockResolvedValue({ detectLines: async () => [{ text: 'ok' }] })
    const result = await handleBatchOcrTask(
      { inputPaths: ['C:/bad.png', 'C:/ok.png'], binariesDir: 'C:/models' },
      { emit: vi.fn() }
    )
    expect(result.items[0]).toMatchObject({
      status: 'failed',
      error: { code: 'BO_OCR_FAILED', detail: 'decode boom' }
    })
    expect(result.items[1]).toMatchObject({ status: 'done' })
  })

  it('未识别到文字 → 单张失败 BO_NO_TEXT', async () => {
    mocks.render.mockResolvedValue([fakePage()])
    mocks.createEngine.mockResolvedValue({ detectLines: async () => [] })
    const result = await handleBatchOcrTask(
      { inputPaths: ['C:/a.png'], binariesDir: 'C:/models' },
      { emit: vi.fn() }
    )
    expect(result.items[0]).toMatchObject({ status: 'failed', error: { code: 'BO_NO_TEXT' } })
  })
})
