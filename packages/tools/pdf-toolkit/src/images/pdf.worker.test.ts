/**
 * @file pdf.worker.test.ts PDF→图片 worker 单测（真实 pdfjs 渲染 + 真实写盘）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 全部页/范围/格式/冲突重命名/损坏 PDF/进度上报
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskUpdate } from '@lumin/shared'
import { runPdfToImages } from './pdf.worker'
import type { PdfToImagesRequest } from './schema'

let root = ''
let pdfPath = ''

function ctxUpdates(): { updates: TaskUpdate[]; ctx: { emit: (u: TaskUpdate) => void } } {
  const updates: TaskUpdate[] = []
  return { updates, ctx: { emit: (u) => updates.push(u) } }
}

/** 生成 n 页 PDF（每页 200×100pt，带文字） */
async function buildPdf(file: string, pages: number): Promise<void> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([200, 100])
    page.drawText(`Page ${index + 1}`, { x: 10, y: 40, size: 14, font, color: rgb(0, 0, 0) })
  }
  await writeFile(file, await pdf.save())
}

function request(overrides: Partial<PdfToImagesRequest> = {}): PdfToImagesRequest {
  return {
    inputPath: pdfPath,
    ranges: '',
    format: 'png',
    dpi: 72,
    outputDir: join(root, 'out'),
    ...overrides
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lumin-pi-pdf-'))
  pdfPath = join(root, '样卷.pdf')
  await buildPdf(pdfPath, 3)
  await mkdir(join(root, 'out'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('runPdfToImages', () => {
  it('空范围 = 全部页，输出 PNG 且进度逐页上报', async () => {
    const { updates, ctx } = ctxUpdates()
    const result = await runPdfToImages(request(), ctx)
    expect(result.pages).toBe(3)
    expect(result.failures).toEqual([])
    expect(result.outputs.map((path) => path.split(/[\\/]/).pop())).toEqual([
      '样卷_p1.png',
      '样卷_p2.png',
      '样卷_p3.png'
    ])
    const bytes = await readFile(result.outputs[0] ?? '')
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47')
    expect(updates).toHaveLength(3)
    expect(updates[0]).toMatchObject({ kind: 'progress', current: 1, total: 3 })
  })

  it('范围 + JPEG：按页输出 .jpg（ffd8ff 头）', async () => {
    const result = await runPdfToImages(
      request({ ranges: '2-3', format: 'jpeg', dpi: 150 }),
      ctxUpdates().ctx
    )
    expect(result.pages).toBe(2)
    expect(result.outputs.map((path) => path.split(/[\\/]/).pop())).toEqual([
      '样卷_p2.jpg',
      '样卷_p3.jpg'
    ])
    const bytes = await readFile(result.outputs[0] ?? '')
    expect(bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff')
  })

  it('冲突重名自动递增', async () => {
    await writeFile(join(root, 'out', '样卷_p1.png'), 'occupied')
    const result = await runPdfToImages(request({ ranges: '1' }), ctxUpdates().ctx)
    expect(result.outputs[0]).toBe(join(root, 'out', '样卷_p1 (1).png'))
    expect(await readdir(join(root, 'out'))).toContain('样卷_p1 (1).png')
  })

  it('越界范围 → PI_RANGE_INVALID', async () => {
    await expect(
      runPdfToImages(request({ ranges: '1-9' }), ctxUpdates().ctx)
    ).rejects.toMatchObject({ code: 'PI_RANGE_INVALID' })
  })

  it('损坏 PDF → PI_PDF_CORRUPT', async () => {
    const bad = join(root, 'bad.pdf')
    await writeFile(bad, 'not a pdf')
    await expect(
      runPdfToImages(request({ inputPath: bad }), ctxUpdates().ctx)
    ).rejects.toMatchObject({ code: 'PI_PDF_CORRUPT' })
  })

  it('文件不存在 → PI_INPUT_INVALID', async () => {
    await expect(
      runPdfToImages(request({ inputPath: join(root, 'missing.pdf') }), ctxUpdates().ctx)
    ).rejects.toMatchObject({ code: 'PI_INPUT_INVALID' })
  })
})
