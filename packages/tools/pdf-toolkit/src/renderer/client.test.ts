import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelTask,
  compress,
  deletePages,
  extractImages,
  extractText,
  exportHtml,
  info,
  merge,
  pageNumbers,
  reorder,
  revealPath,
  rotate,
  saveMetadata,
  split,
  watermark
} from './client'

const invoke = vi.fn<(channel: string, payload?: unknown) => Promise<unknown>>(() =>
  Promise.resolve({ taskId: 't1' })
)
const reveal = vi.fn(() => Promise.resolve())

afterEach(() => {
  vi.unstubAllGlobals()
  invoke.mockClear()
  reveal.mockClear()
})

function stubLumin(): void {
  vi.stubGlobal('window', { lumin: { invoke, revealPath: reveal } })
}

describe('pdf-toolkit client（通道名与壳一致）', () => {
  it('info 走同步通道', async () => {
    stubLumin()
    await info({ inputPath: 'C:/a.pdf' })
    expect(invoke).toHaveBeenCalledWith('pdf-toolkit:info', { inputPath: 'C:/a.pdf' })
  })

  it('八个任务通道前缀正确', async () => {
    stubLumin()
    await merge({ inputPaths: ['C:/a.pdf', 'C:/b.pdf'] })
    await split({ inputPath: 'C:/a.pdf', ranges: '1' })
    await deletePages({ inputPath: 'C:/a.pdf', ranges: '1' })
    await rotate({ inputPath: 'C:/a.pdf', degrees: 90 })
    await reorder({ inputPath: 'C:/a.pdf', order: [1] })
    await saveMetadata({ inputPath: 'C:/a.pdf', metadata: { title: 'T' } })
    await watermark({
      kind: 'text',
      inputPath: 'C:/a.pdf',
      imageData: 'iVBORw0KGgo=',
      opacity: 0.4,
      angle: 0,
      scale: 20,
      tile: false
    })
    await pageNumbers({
      inputPath: 'C:/a.pdf',
      format: '{n}',
      position: 'bottom-center',
      startPage: 1,
      fontSize: 12,
      color: '#333333',
      margin: 24
    })
    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      'pdf-toolkit:merge',
      'pdf-toolkit:split',
      'pdf-toolkit:delete',
      'pdf-toolkit:rotate',
      'pdf-toolkit:reorder',
      'pdf-toolkit:metadata',
      'pdf-toolkit:watermark',
      'pdf-toolkit:page-numbers'
    ])
  })

  it('取消与打开目录复用壳通道', async () => {
    stubLumin()
    invoke.mockResolvedValueOnce(true)
    await expect(cancelTask('t1')).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledWith('lumin:task:cancel', { taskId: 't1' })
    await revealPath('C:/out/a.pdf')
    expect(reveal).toHaveBeenCalledWith('C:/out/a.pdf')
  })

  it('提取/压缩通道（M38）', async () => {
    stubLumin()
    await extractText({ inputPath: 'C:/a.pdf' })
    expect(invoke).toHaveBeenCalledWith('pdf-toolkit:extract-text', { inputPath: 'C:/a.pdf' })
    await extractImages({ inputPath: 'C:/a.pdf', ranges: '1-2' })
    expect(invoke).toHaveBeenCalledWith('pdf-toolkit:extract-images', {
      inputPath: 'C:/a.pdf',
      ranges: '1-2'
    })
    await compress({ inputPath: 'C:/a.pdf', level: 'high' })
    expect(invoke).toHaveBeenCalledWith('pdf-toolkit:compress', {
      inputPath: 'C:/a.pdf',
      level: 'high'
    })
  })

  it('PDF→HTML 通道（M63）', async () => {
    stubLumin()
    await exportHtml({ inputPath: 'C:/a.pdf', ranges: '2-3' })
    expect(invoke).toHaveBeenCalledWith('pdf-toolkit:export-html', {
      inputPath: 'C:/a.pdf',
      ranges: '2-3'
    })
  })
})
