/**
 * @file renderer client 单测（通道名与壳契约一致）
 * @author cuilanchao
 * @date 2026-11-19
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelTask,
  config,
  pickDirectory,
  revealPath,
  saveTxt,
  submitRecognize
} from './client'

const invoke = vi.fn<(channel: string, payload?: unknown) => Promise<unknown>>(() =>
  Promise.resolve({ taskId: 't1', output: 'C:/out/a-OCR.txt', outputDir: 'C:/out' })
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
    const result = await submitRecognize({ inputPath: 'C:/a.png' })
    expect(invoke).toHaveBeenCalledWith('ocr-text:recognize', { inputPath: 'C:/a.png' })
    expect(result.taskId).toBe('t1')
  })

  it('config 走 ocr-text:config（空对象入参）', async () => {
    stubLumin()
    await config()
    expect(invoke).toHaveBeenCalledWith('ocr-text:config', {})
  })

  it('saveTxt 走 ocr-text:save-txt 并透传 output', async () => {
    stubLumin()
    const result = await saveTxt({
      outputDir: 'C:/out',
      inputPath: 'C:/a.png',
      text: '内容'
    })
    expect(invoke).toHaveBeenCalledWith('ocr-text:save-txt', {
      outputDir: 'C:/out',
      inputPath: 'C:/a.png',
      text: '内容'
    })
    expect(result.output).toBe('C:/out/a-OCR.txt')
  })

  it('cancelTask 走壳通用 lumin:task:cancel', async () => {
    stubLumin()
    await cancelTask('t1')
    expect(invoke).toHaveBeenCalledWith('lumin:task:cancel', { taskId: 't1' })
  })

  it('revealPath / pickDirectory 委托 bridge', async () => {
    stubLumin()
    await revealPath('C:/out/a-OCR.txt')
    await pickDirectory('选择 TXT 导出目录')
    expect(reveal).toHaveBeenCalledWith('C:/out/a-OCR.txt')
    expect(pick).toHaveBeenCalledWith('选择 TXT 导出目录')
  })
})
