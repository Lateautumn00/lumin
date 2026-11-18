import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cancelTask,
  revealPath,
  submitCrop,
  submitDelete,
  submitMerge,
  submitOcrDetect,
  submitOcrExport,
  submitRotate,
  submitSplit
} from './client'

interface RecordedCall {
  channel: string
  payload: unknown
}

let calls: RecordedCall[] = []

beforeEach(() => {
  calls = []
  Object.assign(globalThis, {
    window: {
      lumin: {
        invoke: async (channel: string, payload: unknown): Promise<unknown> => {
          calls.push({ channel, payload })
          return channel.startsWith('lumin:') ? undefined : { taskId: 'task-9' }
        },
        revealPath: async (path: string): Promise<void> => {
          calls.push({ channel: 'revealPath', payload: path })
        }
      }
    }
  })
})

afterEach(() => {
  Object.assign(globalThis, { window: undefined })
})

describe('renderer client（exam-split:* 通道，spec §4）', () => {
  it('五个提交函数走对应任务通道并回传 taskId', async () => {
    await expect(submitSplit({ inputPath: 'a.pdf', ranges: '1-2' })).resolves.toEqual({
      taskId: 'task-9'
    })
    await expect(submitMerge({ inputPaths: ['a.pdf', 'b.pdf'] })).resolves.toEqual({
      taskId: 'task-9'
    })
    await expect(submitDelete({ inputPath: 'a.pdf', ranges: '3' })).resolves.toEqual({
      taskId: 'task-9'
    })
    await expect(submitRotate({ inputPath: 'a.pdf', degrees: 180 })).resolves.toEqual({
      taskId: 'task-9'
    })
    await expect(
      submitCrop({ inputPath: 'a.pdf', box: { x: 0, y: 0, width: 1, height: 1 } })
    ).resolves.toEqual({ taskId: 'task-9' })

    expect(calls.map((call) => call.channel)).toEqual([
      'exam-split:split',
      'exam-split:merge',
      'exam-split:delete',
      'exam-split:rotate',
      'exam-split:crop'
    ])
    expect(calls[0]?.payload).toEqual({ inputPath: 'a.pdf', ranges: '1-2' })
    expect(calls[3]?.payload).toEqual({ inputPath: 'a.pdf', degrees: 180 })
  })

  it('cancelTask 走通用取消通道', async () => {
    await cancelTask('task-9')
    expect(calls).toEqual([{ channel: 'lumin:task:cancel', payload: { taskId: 'task-9' } }])
  })

  it('OCR 两段式（spec §10.4）：detect 带旋转缺省 0，export 带最终边界', async () => {
    await expect(submitOcrDetect({ inputPath: 'C:/试卷/卷1.pdf', rotation: 0 })).resolves.toEqual({
      taskId: 'task-9'
    })
    await submitOcrExport({
      inputPath: 'C:/试卷/卷1.pdf',
      rotation: 0,
      startNumber: 3,
      exportPdf: true,
      pages: [
        { pageNumber: 1, width: 893, height: 1263, regions: [{ start: 0, end: 1, lines: [] }] }
      ]
    })
    expect(calls.map((call) => call.channel)).toEqual([
      'exam-split:ocr-detect',
      'exam-split:ocr-export'
    ])
    expect(calls[0]?.payload).toEqual({ inputPath: 'C:/试卷/卷1.pdf', rotation: 0 })
    expect(calls[1]?.payload).toMatchObject({ rotation: 0, startNumber: 3, exportPdf: true })
  })

  it('revealPath 委托桥的资源管理器定位', async () => {
    await revealPath('C:/试卷/out.pdf')
    expect(calls).toEqual([{ channel: 'revealPath', payload: 'C:/试卷/out.pdf' }])
  })
})
