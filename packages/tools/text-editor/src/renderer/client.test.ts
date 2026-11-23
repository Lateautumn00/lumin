import { afterEach, describe, expect, it, vi } from 'vitest'
import { open, save, saveAs } from './client'

const invoke = vi.fn()

vi.stubGlobal('window', { lumin: { invoke } })

afterEach(() => {
  invoke.mockReset()
})

describe('text-editor client', () => {
  it('open 调用 text-editor:open', async () => {
    const result = {
      path: 'C:\\a.txt',
      name: 'a.txt',
      size: 1,
      mtimeMs: 1,
      content: 'a',
      encoding: 'utf8',
      eol: 'lf',
      readOnly: false
    }
    invoke.mockResolvedValue(result)
    await expect(open({ path: 'C:\\a.txt' })).resolves.toEqual(result)
    expect(invoke).toHaveBeenCalledWith('text-editor:open', { path: 'C:\\a.txt' })
  })

  it('save 透传编码、EOL 与 mtime', async () => {
    invoke.mockResolvedValue({ mtimeMs: 9 })
    const payload = {
      path: 'C:\\a.txt',
      content: 'hi',
      encoding: 'gbk' as const,
      eol: 'crlf' as const,
      expectedMtimeMs: 8
    }
    await expect(save(payload)).resolves.toEqual({ mtimeMs: 9 })
    expect(invoke).toHaveBeenCalledWith('text-editor:save', payload)
  })

  it('saveAs 调用 text-editor:save-as', async () => {
    invoke.mockResolvedValue({ path: 'C:\\docs\\b.txt', mtimeMs: 10 })
    const payload = {
      dir: 'C:\\docs',
      name: 'b.txt',
      content: 'x',
      encoding: 'utf8' as const,
      eol: 'lf' as const
    }
    await saveAs(payload)
    expect(invoke).toHaveBeenCalledWith('text-editor:save-as', payload)
  })
})
