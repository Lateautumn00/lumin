/**
 * @file renderer IPC 客户端单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 断言 8 个封装的通道名与入参透传（stub window.lumin）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDraft,
  loadDraft,
  openDialog,
  openDocument,
  readTextFile,
  saveDocument,
  saveDraft,
  writeExport
} from './client'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({})
  vi.stubGlobal('window', { lumin: { invoke } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('client', () => {
  it('openDialog 走 mindmap:open-dialog', async () => {
    await openDialog()
    expect(invoke).toHaveBeenCalledWith('mindmap:open-dialog', {})
  })

  it('openDocument 透传路径', async () => {
    await openDocument({ path: 'C:/a.json' })
    expect(invoke).toHaveBeenCalledWith('mindmap:open-document', { path: 'C:/a.json' })
  })

  it('saveDocument 透传完整载荷', async () => {
    const payload = {
      path: 'C:/a.json',
      data: { nodeData: { id: 'a', topic: '根' } },
      force: true
    }
    await saveDocument(payload)
    expect(invoke).toHaveBeenCalledWith('mindmap:save-document', payload)
  })

  it('readTextFile 透传路径', async () => {
    await readTextFile({ path: 'C:/a.md' })
    expect(invoke).toHaveBeenCalledWith('mindmap:read-text-file', { path: 'C:/a.md' })
  })

  it('writeExport 透传文本/base64', async () => {
    await writeExport({ path: 'C:/a.svg', text: '<svg />' })
    expect(invoke).toHaveBeenCalledWith('mindmap:write-export', {
      path: 'C:/a.svg',
      text: '<svg />'
    })
    await writeExport({ path: 'C:/a.png', base64: 'AAAA' })
    expect(invoke).toHaveBeenCalledWith('mindmap:write-export', {
      path: 'C:/a.png',
      base64: 'AAAA'
    })
  })

  it('草稿三通道入参', async () => {
    await loadDraft()
    expect(invoke).toHaveBeenCalledWith('mindmap:load-draft', {})
    const payload = {
      data: { nodeData: { id: 'a', topic: '根' } },
      documentPath: 'C:/a.json'
    }
    await saveDraft(payload)
    expect(invoke).toHaveBeenCalledWith('mindmap:save-draft', payload)
    await clearDraft()
    expect(invoke).toHaveBeenCalledWith('mindmap:clear-draft', {})
  })
})
