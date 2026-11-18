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

  it('rotation：缺省 0，+90/−90 累加并回绕（spec §10.12）', () => {
    const ws = createOcrWorkspace()
    expect(ws.rotation.value).toBe(0)
    ws.rotate(90)
    expect(ws.rotation.value).toBe(90)
    ws.rotate(90)
    expect(ws.rotation.value).toBe(180)
    ws.rotate(-90)
    expect(ws.rotation.value).toBe(90)
    ws.rotate(-90)
    ws.rotate(-90)
    expect(ws.rotation.value).toBe(270)
    ws.rotate(90)
    expect(ws.rotation.value).toBe(0)
  })

  it('rotate 是破坏性操作：清空题区/自动结果/手动模式/结果与进度残留', () => {
    const ws = createOcrWorkspace()
    const original = page(1, 2)
    ws.pages.value = [original]
    ws.detected.value = [original]
    ws.manualMode.value = true
    ws.pageNumber.value = 3
    ws.selected.value = { pageNumber: 1, columnIndex: 0, afterRegion: 1 }
    ws.activeRegion.value = 0
    ws.adding.value = true
    ws.error.value = { code: 'OCR_FAILED', message: '识别失败' }
    ws.outputPaths.value = ['C:/卷_题1.png']
    ws.pageSizes.value = { 1: { width: 10, height: 20 } }
    ws.rotate(90)
    expect(ws.pages.value).toEqual([])
    expect(ws.detected.value).toEqual([])
    expect(ws.manualMode.value).toBe(false)
    expect(ws.pageNumber.value).toBe(1)
    expect(ws.selected.value).toBeNull()
    expect(ws.activeRegion.value).toBeNull()
    expect(ws.adding.value).toBe(false)
    expect(ws.error.value).toBeNull()
    expect(ws.outputPaths.value).toEqual([])
    expect(ws.pageSizes.value).toEqual({})
  })
})
