/**
 * @file renderer client 单测（通道名与壳契约一致）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelTask, config, exportTxt, pickDirectory, revealPath, submitRecognize } from './client'

const invoke = vi.fn<(channel: string, payload?: unknown) => Promise<unknown>>(() =>
  Promise.resolve({ taskId: 't1', outputs: ['C:/out/a-OCR.txt'], outputDir: 'C:/out' })
)
const reveal = vi.fn(() => Promise.resolve())
const pick = vi.fn(() => Promise.resolve<string | null>('C:/out'))

afterEach(() => {
  vi.unstubAllGlobals()
  invoke.mockClear()
  reveal.mockClear()
  pick.mockClear()
})

function stubLumin(): void {
  vi.stubGlobal('window', {
    lumin: { invoke, revealPath: reveal, pickDirectory: pick }
  })
}

describe('ocr-text client', () => {
  it('submitRecognize 走 ocr-text:recognize 并透传 taskId', async () => {
    stubLumin()
    const result = await submitRecognize({ inputPaths: ['C:/a.png', 'C:/b.png'] })
    expect(invoke).toHaveBeenCalledWith('ocr-text:recognize', {
      inputPaths: ['C:/a.png', 'C:/b.png']
    })
    expect(result.taskId).toBe('t1')
  })

  it('config 走 ocr-text:config（空对象入参）', async () => {
    stubLumin()
    await config()
    expect(invoke).toHaveBeenCalledWith('ocr-text:config', {})
  })

  it('exportTxt 走 ocr-text:export 并透传 outputs', async () => {
    stubLumin()
    const payload = {
      outputDir: 'C:/out',
      mode: 'merged' as const,
      items: [{ fileName: 'a.png', text: '内容' }]
    }
    const result = await exportTxt(payload)
    expect(invoke).toHaveBeenCalledWith('ocr-text:export', payload)
    expect(result.outputs).toEqual(['C:/out/a-OCR.txt'])
  })

  it('cancelTask 走壳取消通道', async () => {
    stubLumin()
    await cancelTask('t1')
    expect(invoke).toHaveBeenCalledWith('lumin:task:cancel', { taskId: 't1' })
  })

  it('revealPath / pickDirectory 复用壳通道', async () => {
    stubLumin()
    await revealPath('C:/out/a.txt')
    await pickDirectory('选择导出目录')
    expect(reveal).toHaveBeenCalledWith('C:/out/a.txt')
    expect(pick).toHaveBeenCalledWith('选择导出目录')
  })
})
