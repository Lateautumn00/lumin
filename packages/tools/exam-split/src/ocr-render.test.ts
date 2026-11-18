import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import {
  PDF_RENDER_SCALE,
  classifyPdfjsError,
  classifyReadError,
  encodePng,
  ensureCjkFont,
  renderOcrInput,
  rotatedSize,
  type RenderOptions
} from './ocr-render'
import type { RgbaImage } from './ocr-preproc'

const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url))
const THREE_PAGE = join(FIXTURES, '三页卷.pdf')
const ENCRYPTED = join(FIXTURES, 'encrypted.pdf')

let root = ''

function tempRoot(): string {
  if (root === '') root = mkdtempSync(join(tmpdir(), 'lumin-exam-render-'))
  return root
}

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true })
})

function expectCode(run: () => Promise<unknown>, code: string): Promise<void> {
  return run().then(
    () => Promise.reject(new Error(`应当抛 ${code}`)),
    (err: unknown) => {
      expect(err).toMatchObject({ code })
    }
  )
}

/** 采样四角与中心像素（断言不透明 + 白底兜底） */
function samplePixels(image: RgbaImage): number[][] {
  const points: [number, number][] = [
    [0, 0],
    [image.width - 1, 0],
    [0, image.height - 1],
    [image.width - 1, image.height - 1],
    [image.width >> 1, image.height >> 1]
  ]
  return points.map(([x, y]) => {
    const i = (y * image.width + x) * 4
    return [
      image.data[i] ?? 0,
      image.data[i + 1] ?? 0,
      image.data[i + 2] ?? 0,
      image.data[i + 3] ?? 0
    ]
  })
}

describe('renderOcrInput · PDF（spec §10.1）', () => {
  it('三页卷 → 3 页 RGBA，A4@1.5 倍率尺寸、全不透明', async () => {
    const pages = await renderOcrInput(THREE_PAGE)
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3])
    for (const page of pages) {
      expect(page.width).toBe(Math.ceil(595 * PDF_RENDER_SCALE))
      expect(page.height).toBe(Math.ceil(842 * PDF_RENDER_SCALE))
      expect(page.image.width).toBe(page.width)
      expect(page.image.height).toBe(page.height)
      for (const rgba of samplePixels(page.image)) {
        expect(rgba[3]).toBe(255)
      }
    }
  })

  it('中文/空格路径（R2 场景 1）：复制到中文目录后可渲染', async () => {
    const dir = join(tempRoot(), '中文 目录')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, '试卷 副本.pdf')
    copyFileSync(THREE_PAGE, path)
    const pages = await renderOcrInput(path)
    expect(pages).toHaveLength(3)
  })

  it('onPage 进度：0/total 起步、逐页递增到 total', async () => {
    const done: [number, number][] = []
    const options: RenderOptions = { onPage: (d, t) => done.push([d, t]) }
    await renderOcrInput(THREE_PAGE, options)
    expect(done).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3]
    ])
  })

  it('pageNumbers 子集：只渲染指定页（export 按需渲染）', async () => {
    const pages = await renderOcrInput(THREE_PAGE, { pageNumbers: [2] })
    expect(pages.map((page) => page.pageNumber)).toEqual([2])
  })

  it('页码越界 → INVALID_PAYLOAD（不静默跳过）', async () => {
    await expectCode(() => renderOcrInput(THREE_PAGE, { pageNumbers: [4] }), 'INVALID_PAYLOAD')
  })

  it('加密 PDF → PDF_ENCRYPTED（spec §5）', async () => {
    await expectCode(() => renderOcrInput(ENCRYPTED), 'PDF_ENCRYPTED')
  })

  it('坏 PDF（非 PDF 字节）→ PDF_INVALID', async () => {
    const path = join(tempRoot(), '坏文件.pdf')
    writeFileSync(path, 'this is not a pdf at all')
    await expectCode(() => renderOcrInput(path), 'PDF_INVALID')
  })

  it('文件不存在 → PDF_NOT_FOUND（ENOENT 归类）', async () => {
    await expectCode(() => renderOcrInput(join(tempRoot(), '不存在.pdf')), 'PDF_NOT_FOUND')
  })
})

describe('renderOcrInput · 图片（spec §10.1）', () => {
  function makePng(name: string, transparent: false | true = false): string {
    const canvas = createCanvas(120, 80)
    const ctx = canvas.getContext('2d')
    if (transparent) {
      ctx.fillStyle = '#000000'
      ctx.fillRect(20, 20, 40, 40)
    } else {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, 120, 80)
      ctx.fillStyle = '#000000'
      ctx.fillRect(10, 30, 60, 12)
    }
    const path = join(tempRoot(), name)
    writeFileSync(path, canvas.toBuffer('image/png'))
    return path
  }

  it('PNG 输入 → 单页、尺寸与原图一致、像素不透明', async () => {
    const path = makePng('扫描件.png')
    const pages = await renderOcrInput(path)
    expect(pages).toHaveLength(1)
    expect(pages[0]?.pageNumber).toBe(1)
    expect(pages[0]?.width).toBe(120)
    expect(pages[0]?.height).toBe(80)
    expect(pages[0]?.image.data[3]).toBe(255)
  })

  it('图片旋转 90°/270° → 宽高互换且白底不透明', async () => {
    const path = makePng('侧拍.png')
    for (const rotation of [90, 270] as const) {
      const [page] = await renderOcrInput(path, { rotation })
      expect(page?.width).toBe(80)
      expect(page?.height).toBe(120)
      expect(page?.image.data[3]).toBe(255)
      for (const rgba of samplePixels(page!.image)) {
        expect(rgba[3]).toBe(255)
      }
    }
    const [upright] = await renderOcrInput(path, { rotation: 180 })
    expect(upright?.width).toBe(120)
    expect(upright?.height).toBe(80)
  })

  it('透明 PNG → 白底兜底（destination-over 补白，不落黑底）', async () => {
    const path = makePng('透明.png', true)
    const pages = await renderOcrInput(path)
    const corners = samplePixels(pages[0]!.image)
    for (const rgba of corners) {
      expect(rgba[3]).toBe(255)
      expect(rgba.slice(0, 3)).toEqual([255, 255, 255])
    }
  })

  it('坏图片（非图片字节）→ OCR_INPUT_INVALID（解码失败分类，spec §10.5）', async () => {
    const path = join(tempRoot(), '坏图.png')
    writeFileSync(path, 'not-an-image')
    await expectCode(() => renderOcrInput(path), 'OCR_INPUT_INVALID')
  })

  it('图片不存在 → PDF_NOT_FOUND（ENOENT 统一归类）', async () => {
    await expectCode(() => renderOcrInput(join(tempRoot(), '不存在.jpg')), 'PDF_NOT_FOUND')
  })
})

describe('rotatedSize / 旋转渲染（spec §10.12）', () => {
  it('90/270 交换宽高，0/180 保持', () => {
    expect(rotatedSize(120, 80, 0)).toEqual({ width: 120, height: 80 })
    expect(rotatedSize(120, 80, 90)).toEqual({ width: 80, height: 120 })
    expect(rotatedSize(120, 80, 180)).toEqual({ width: 120, height: 80 })
    expect(rotatedSize(120, 80, 270)).toEqual({ width: 80, height: 120 })
  })

  it('PDF 旋转 90° → 渲染尺寸宽高互换（叠加页面固有旋转）', async () => {
    const [page] = await renderOcrInput(THREE_PAGE, { pageNumbers: [1], rotation: 90 })
    expect(page?.width).toBe(Math.ceil(842 * PDF_RENDER_SCALE))
    expect(page?.height).toBe(Math.ceil(595 * PDF_RENDER_SCALE))
    expect(page?.image.width).toBe(page?.width)
    expect(page?.image.height).toBe(page?.height)
  })
})

describe('classifyReadError（spec §5/§10.5 错误分界）', () => {
  function errnoError(code: string): Error {
    return Object.assign(new Error(`${code}: file`), { code })
  }

  it('ENOENT → PDF_NOT_FOUND（PDF/图片统一）', () => {
    expect(classifyReadError(errnoError('ENOENT'), 'pdf')).toMatchObject({
      code: 'PDF_NOT_FOUND',
      detail: 'ENOENT'
    })
    expect(classifyReadError(errnoError('ENOENT'), 'image')).toMatchObject({
      code: 'PDF_NOT_FOUND'
    })
  })

  it('EBUSY/EPERM/EACCES → PDF_LOCKED（文件被占用）', () => {
    for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
      expect(classifyReadError(errnoError(code), 'pdf')).toMatchObject({
        code: 'PDF_LOCKED',
        detail: code
      })
    }
  })

  it('其余 errno → 按输入类型（PDF_INVALID / OCR_INPUT_INVALID）', () => {
    expect(classifyReadError(errnoError('EIO'), 'pdf')).toMatchObject({
      code: 'PDF_INVALID',
      detail: 'EIO'
    })
    expect(classifyReadError(errnoError('EIO'), 'image')).toMatchObject({
      code: 'OCR_INPUT_INVALID',
      detail: 'EIO'
    })
  })

  it('无 errno 的非 Error 抛出物 → detail 取字符串尾部', () => {
    const error = classifyReadError('weird failure', 'image')
    expect(error).toMatchObject({ code: 'OCR_INPUT_INVALID' })
    expect(error.detail).toContain('weird failure')
  })
})

describe('classifyPdfjsError（spec §5）', () => {
  function named(name: string): Error {
    return Object.assign(new Error(`${name}: detail`), { name })
  }

  it('PasswordException → PDF_ENCRYPTED', () => {
    expect(classifyPdfjsError(named('PasswordException'))).toMatchObject({
      code: 'PDF_ENCRYPTED'
    })
  })

  it('MissingPDFException → PDF_NOT_FOUND', () => {
    expect(classifyPdfjsError(named('MissingPDFException'))).toMatchObject({
      code: 'PDF_NOT_FOUND'
    })
  })

  it('其余 Error → PDF_INVALID；非 Error 也不崩', () => {
    expect(classifyPdfjsError(new Error('corrupt'))).toMatchObject({ code: 'PDF_INVALID' })
    expect(classifyPdfjsError(42)).toMatchObject({ code: 'PDF_INVALID' })
  })
})

describe('encodePng（spec §10.7 写后校验头）', () => {
  it('输出魔数 89504E47', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(255)
    const bytes = encodePng({ data, width: 4, height: 4 })
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47')
  })
})

describe('ensureCjkFont', () => {
  it('幂等可重复调用（渲染路径会反复触发）', () => {
    ensureCjkFont()
    expect(() => ensureCjkFont()).not.toThrow()
  })

  it('WINDIR 未设置时回退 C:/Windows（不抛）', async () => {
    const saved = process.env.WINDIR
    delete process.env.WINDIR
    vi.resetModules()
    try {
      const mod = await import('./ocr-render')
      expect(() => mod.ensureCjkFont()).not.toThrow()
    } finally {
      if (saved !== undefined) process.env.WINDIR = saved
      vi.resetModules()
    }
  })
})
