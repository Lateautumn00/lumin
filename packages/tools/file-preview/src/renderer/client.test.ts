import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assetUrl,
  convertOffice,
  inspect,
  readText,
  releasePreview,
  renderPdfPage,
  setSofficePath,
  sofficeStatus
} from './client'

const invoke = vi.fn()

vi.stubGlobal('window', { lumin: { invoke } })

afterEach(() => {
  invoke.mockReset()
})

describe('file-preview client', () => {
  it('inspect 调用 file-preview:inspect', async () => {
    invoke.mockResolvedValue({ previewId: 'fp-1' })
    const payload = { path: 'C:\\a.pdf' }
    await expect(inspect(payload)).resolves.toEqual({ previewId: 'fp-1' })
    expect(invoke).toHaveBeenCalledWith('file-preview:inspect', payload)
  })

  it('readText 透传 maxBytes', async () => {
    invoke.mockResolvedValue({ text: '' })
    const payload = { path: 'C:\\a.txt', maxBytes: 1024 }
    await readText(payload)
    expect(invoke).toHaveBeenCalledWith('file-preview:read-text', payload)
  })

  it('assetUrl 调用图片 URL 通道', async () => {
    invoke.mockResolvedValue({ url: 'file:///C:/a.png' })
    await expect(assetUrl({ path: 'C:\\a.png' })).resolves.toEqual({
      url: 'file:///C:/a.png'
    })
    expect(invoke).toHaveBeenCalledWith('file-preview:asset-url', { path: 'C:\\a.png' })
  })

  it('convertOffice 返回 taskId', async () => {
    invoke.mockResolvedValue({ taskId: 't1' })
    await expect(convertOffice({ path: 'C:\\a.docx' })).resolves.toEqual({ taskId: 't1' })
    expect(invoke).toHaveBeenCalledWith('file-preview:convert-office', { path: 'C:\\a.docx' })
  })

  it('renderPdfPage 透传页码与缩放', async () => {
    invoke.mockResolvedValue({ png: 'AA', width: 1, height: 1 })
    const payload = { previewId: 'fp-1', page: 2, scale: 1.5 }
    await renderPdfPage(payload)
    expect(invoke).toHaveBeenCalledWith('file-preview:render-pdf-page', payload)
  })

  it('releasePreview 调用释放通道', async () => {
    invoke.mockResolvedValue({ released: true })
    await expect(releasePreview({ previewId: 'fp-1' })).resolves.toEqual({ released: true })
    expect(invoke).toHaveBeenCalledWith('file-preview:release-preview', { previewId: 'fp-1' })
  })

  it('sofficeStatus 发送空载荷', async () => {
    invoke.mockResolvedValue({ found: false })
    await sofficeStatus()
    expect(invoke).toHaveBeenCalledWith('file-preview:soffice-status', {})
  })

  it('setSofficePath 透传路径', async () => {
    invoke.mockResolvedValue({ found: true, path: 'C:\\soffice.com' })
    await setSofficePath({ path: 'C:\\soffice.com' })
    expect(invoke).toHaveBeenCalledWith('file-preview:set-soffice-path', {
      path: 'C:\\soffice.com'
    })
  })
})
