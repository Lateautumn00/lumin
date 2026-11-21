/**
 * @file renderer client 单测（白名单 bridge 通道名与载荷）
 * @author cuilanchao
 * @date 2026-11-21
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { config, revealPath, saveFile, saveOutputDir } from './client'

const invoke = vi.fn()
const reveal = vi.fn()

vi.stubGlobal('window', { lumin: { invoke, revealPath: reveal } })

afterEach(() => {
  invoke.mockReset()
  reveal.mockReset()
})

describe('client', () => {
  it('config 调用 markdown-tool:config', async () => {
    invoke.mockResolvedValue({ outputDir: 'C:\\out' })
    await expect(config()).resolves.toEqual({ outputDir: 'C:\\out' })
    expect(invoke).toHaveBeenCalledWith('markdown-tool:config', {})
  })

  it('saveOutputDir 调用 set-output-dir 并传目录', async () => {
    invoke.mockResolvedValue(undefined)
    await saveOutputDir('C:\\记忆')
    expect(invoke).toHaveBeenCalledWith('markdown-tool:set-output-dir', { outputDir: 'C:\\记忆' })
  })

  it('saveFile 透传载荷', async () => {
    invoke.mockResolvedValue({ output: 'C:\\out\\a.html' })
    const payload = {
      outputDir: 'C:\\out',
      baseName: 'a',
      extension: 'html' as const,
      content: '<h1>x</h1>'
    }
    await expect(saveFile(payload)).resolves.toEqual({ output: 'C:\\out\\a.html' })
    expect(invoke).toHaveBeenCalledWith('markdown-tool:save', payload)
  })

  it('revealPath 复用壳通道', async () => {
    reveal.mockResolvedValue(undefined)
    await revealPath('C:\\out')
    expect(reveal).toHaveBeenCalledWith('C:\\out')
  })
})
