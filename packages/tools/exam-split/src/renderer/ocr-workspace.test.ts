import { describe, expect, it } from 'vitest'
import type { OcrPage } from '../schema'
import { createOcrWorkspace } from './ocr-workspace'

function page(pageNumber: number, regions = 1): OcrPage {
  return {
    pageNumber,
    width: 893,
    height: 1263,
    regions: Array.from({ length: regions }, (_, index) => ({
      start: index / regions,
      end: (index + 1) / regions,
      lines: []
    }))
  }
}

describe('createOcrWorkspace（OCR Tab 共享会话）', () => {
  it('初始为空态：无输入、无题区、空闲、默认题号 1 + 合成 PDF', () => {
    const ws = createOcrWorkspace()
    expect(ws.inputFile.value).toBeNull()
    expect(ws.path.value).toBe('')
    expect(ws.pages.value).toEqual([])
    expect(ws.detected.value).toEqual([])
    expect(ws.running.value).toBeNull()
    expect(ws.startNumber.value).toBe(1)
    expect(ws.exportPdf.value).toBe(true)
    expect(ws.pageSizes.value).toEqual({})
  })

  it('resetCurrentPage：自动页恢复该页自动结果，其他页微调保留', () => {
    const ws = createOcrWorkspace()
    const original = page(1, 2)
    const edited: OcrPage = { ...original, regions: [{ start: 0, end: 0.6, lines: [] }] }
    const other = page(2, 1)
    ws.detected.value = [original, other]
    ws.pages.value = [edited, other]
    ws.pageNumber.value = 1
    ws.selected.value = { pageNumber: 1, columnIndex: 0, afterRegion: 0 }
    ws.resetCurrentPage()
    expect(ws.pages.value[0]).toEqual(original)
    expect(ws.pages.value[1]).toEqual(other)
    expect(ws.selected.value).toBeNull()
    expect(ws.activeRegion.value).toBeNull()
  })

  it('resetCurrentPage：手动页（无自动结果）清空题区但保留页尺寸', () => {
    const ws = createOcrWorkspace()
    ws.pages.value = [page(3, 1)]
    ws.pageNumber.value = 3
    ws.resetCurrentPage()
    expect(ws.pages.value[0]).toEqual({ pageNumber: 3, width: 893, height: 1263, regions: [] })
  })
})
