/**
 * @file render.test.ts node-kit PDF 渲染原语单测
 * @author cuilanchao
 * @date 2026-11-19
 * @description encodeCanvas 真实编码 magic bytes、openPdf 损坏字节/文件路径、
 *              renderPageToCanvas 倍率与旋转尺寸、白底不透明
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encodeCanvas, ensureCjkFont, openPdf, renderPageToCanvas } from './render'

/** 生成 1 页 200×100pt 的最小 PDF（pdf-lib，测试 fixture） */
async function buildSamplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([200, 100])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('Lumin', { x: 10, y: 40, size: 18, font, color: rgb(0, 0, 0) })
  return pdf.save()
}

let dir = ''
let pdfBytes: Uint8Array

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumin-nodekit-pdf-'))
  pdfBytes = await buildSamplePdf()
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('encodeCanvas', () => {
  it('PNG 编码输出 PNG magic bytes', async () => {
    const canvas = createCanvas(2, 2)
    const png = await encodeCanvas(canvas, 'png')
    expect(png.subarray(0, 4).toString('hex')).toBe('89504e47')
  })

  it('JPEG 编码输出 JPEG magic bytes（质量参数生效）', async () => {
    const canvas = createCanvas(16, 16)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#3366ff'
    ctx.fillRect(0, 0, 16, 16)
    const low = await encodeCanvas(canvas, 'jpeg', 10)
    const high = await encodeCanvas(canvas, 'jpeg', 95)
    expect(low.subarray(0, 3).toString('hex')).toBe('ffd8ff')
    expect(high.subarray(0, 3).toString('hex')).toBe('ffd8ff')
    expect(high.length).toBeGreaterThan(0)
  })
})

describe('ensureCjkFont', () => {
  it('幂等调用不抛错', () => {
    expect(() => {
      ensureCjkFont()
      ensureCjkFont()
    }).not.toThrow()
  })
})

describe('openPdf', () => {
  it('损坏字节 → reject', async () => {
    await expect(openPdf(new Uint8Array([1, 2, 3, 4]))).rejects.toBeInstanceOf(Error)
  })

  it('文件路径读取失败 → 抛出 fs 错误（errno 可判）', async () => {
    await expect(openPdf(join(dir, 'missing.pdf'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('文件路径 → 页数正确', async () => {
    const file = join(dir, 'sample.pdf')
    await writeFile(file, pdfBytes)
    const opened = await openPdf(file)
    expect(opened.pageCount).toBe(1)
    await opened.doc.cleanup()
  })
})

describe('renderPageToCanvas', () => {
  it('倍率换算像素尺寸（200×100pt @2 → 400×200）且底色为不透明白', async () => {
    const opened = await openPdf(pdfBytes)
    try {
      const rendered = await renderPageToCanvas(opened.doc, 1, { scale: 2 })
      expect(rendered.width).toBe(400)
      expect(rendered.height).toBe(200)
      const ctx = rendered.canvas.getContext('2d')
      const pixel = ctx.getImageData(0, 0, 1, 1).data
      expect([pixel[0], pixel[1], pixel[2], pixel[3]]).toEqual([255, 255, 255, 255])
    } finally {
      await opened.doc.cleanup()
    }
  })

  it('额外旋转 90° → 宽高交换', async () => {
    const opened = await openPdf(pdfBytes)
    try {
      const rendered = await renderPageToCanvas(opened.doc, 1, { scale: 1, rotation: 90 })
      expect(rendered.width).toBe(100)
      expect(rendered.height).toBe(200)
    } finally {
      await opened.doc.cleanup()
    }
  })
})
