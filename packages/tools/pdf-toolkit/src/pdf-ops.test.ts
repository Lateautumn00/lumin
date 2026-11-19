import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterAll, describe, expect, it } from 'vitest'
import {
  addPageNumbers,
  centerImageAnchor,
  deletePages,
  hexToRgb,
  inspectPdf,
  isValidOrder,
  mergePdf,
  pageNumberPosition,
  pageNumberText,
  reorderPages,
  rotatePages,
  runOp,
  splitPdf,
  watermarkPdf,
  writeMetadata
} from './pdf-ops'

/** 1×1 透明 PNG（免 fixture） */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lumin-pt-'))
  roots.push(dir)
  return dir
}

/** 造样本 PDF（可指定每页尺寸，用于校验页序） */
async function makePdf(
  path: string,
  pageCount: number,
  sizes?: ReadonlyArray<readonly [number, number]>
): Promise<void> {
  const doc = await PDFDocument.create()
  for (let index = 0; index < pageCount; index += 1) {
    const size = sizes?.[index]
    doc.addPage(size ? [size[0], size[1]] : [300 + index * 10, 400 + index * 10])
  }
  await writeFile(path, await doc.save())
}

const noEmit = (): void => undefined

afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('pdf-ops 合并', () => {
  it('按顺序合并全部页并返回路径', async () => {
    const dir = await tempDir()
    const a = join(dir, '甲.pdf')
    const b = join(dir, '乙 卷.pdf')
    await makePdf(a, 2)
    await makePdf(b, 3)
    const result = await mergePdf([a, b], noEmit)
    expect(result.outputPaths).toEqual([join(dir, '甲_合并.pdf')])
    const merged = await PDFDocument.load(await readBytes(result.outputPaths[0] as string))
    expect(merged.getPageCount()).toBe(5)
  })

  it('重名时递增 (1)', async () => {
    const dir = await tempDir()
    const a = join(dir, '甲.pdf')
    const b = join(dir, '乙.pdf')
    await makePdf(a, 1)
    await makePdf(b, 1)
    await mergePdf([a, b], noEmit)
    const second = await mergePdf([a, b], noEmit)
    expect(second.outputPaths).toEqual([join(dir, '甲_合并(1).pdf')])
  })

  it('源文件不存在 → PT_INPUT_INVALID', async () => {
    const dir = await tempDir()
    await expect(mergePdf([join(dir, '缺失.pdf')], noEmit)).rejects.toMatchObject({
      code: 'PT_INPUT_INVALID'
    })
  })

  it('冲突递增耗尽（99 次）→ PT_OUTPUT_WRITE_FAILED', async () => {
    const dir = await tempDir()
    const a = join(dir, '甲.pdf')
    const b = join(dir, '乙.pdf')
    await makePdf(a, 1)
    await makePdf(b, 1)
    await writeFile(join(dir, '甲_合并.pdf'), 'x')
    for (let index = 1; index <= 99; index += 1) {
      await writeFile(join(dir, `甲_合并(${index}).pdf`), 'x')
    }
    await expect(mergePdf([a, b], noEmit)).rejects.toMatchObject({
      code: 'PT_OUTPUT_WRITE_FAILED'
    })
  })
})

describe('pdf-ops 拆分', () => {
  it('每组一个产物且页数正确', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 5)
    const result = await splitPdf(input, '1-2,4-5', noEmit)
    expect(result.outputPaths).toEqual([join(dir, '卷_p1-2.pdf'), join(dir, '卷_p4-5.pdf')])
    const first = await PDFDocument.load(await readBytes(result.outputPaths[0] as string))
    expect(first.getPageCount()).toBe(2)
  })

  it('区间越界/重叠 → PT_RANGE_INVALID', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 3)
    await expect(splitPdf(input, '1-9', noEmit)).rejects.toMatchObject({
      code: 'PT_RANGE_INVALID'
    })
    await expect(splitPdf(input, '1-2,2-3', noEmit)).rejects.toMatchObject({
      code: 'PT_RANGE_INVALID'
    })
  })
})

describe('pdf-ops 删页', () => {
  it('删除指定页保留其余', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 4)
    const result = await deletePages(input, '2,4', noEmit)
    expect(result.outputPaths).toEqual([join(dir, '卷_删p2,4.pdf')])
    const output = await PDFDocument.load(await readBytes(result.outputPaths[0] as string))
    expect(output.getPageCount()).toBe(2)
  })

  it('删光全部页 → PT_NO_PAGES_LEFT', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 2)
    await expect(deletePages(input, '1-2', noEmit)).rejects.toMatchObject({
      code: 'PT_NO_PAGES_LEFT'
    })
    await expect(deletePages(input, 'abc', noEmit)).rejects.toMatchObject({
      code: 'PT_RANGE_INVALID'
    })
  })
})

describe('pdf-ops 旋转', () => {
  it('仅旋转指定页并叠加角度', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 3)
    const result = await rotatePages(input, '2', 90, noEmit)
    const output = await PDFDocument.load(await readBytes(result.outputPaths[0] as string))
    expect(output.getPage(0)?.getRotation().angle).toBe(0)
    expect(output.getPage(1)?.getRotation().angle).toBe(90)
    expect(output.getPage(2)?.getRotation().angle).toBe(0)
  })

  it('空范围旋转全部页', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 2)
    const result = await rotatePages(input, undefined, 180, noEmit)
    const output = await PDFDocument.load(await readBytes(result.outputPaths[0] as string))
    expect(
      output.getPageIndices().map((index) => output.getPage(index)?.getRotation().angle)
    ).toEqual([180, 180])
  })

  it('范围越界 → PT_RANGE_INVALID', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 1)
    await expect(rotatePages(input, '2', 90, noEmit)).rejects.toMatchObject({
      code: 'PT_RANGE_INVALID'
    })
  })
})

describe('pdf-ops 重排', () => {
  it('按全排列重写页序（用尺寸校验）', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 3, [
      [300, 400],
      [400, 500],
      [500, 600]
    ])
    const result = await reorderPages(input, [3, 1, 2], noEmit)
    const output = await PDFDocument.load(await readBytes(result.outputPaths[0] as string))
    expect(output.getPage(0)?.getSize()).toMatchObject({ width: 500, height: 600 })
    expect(output.getPage(1)?.getSize()).toMatchObject({ width: 300, height: 400 })
  })

  it('非全排列 → PT_ORDER_INVALID', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 3)
    await expect(reorderPages(input, [1, 1, 2], noEmit)).rejects.toMatchObject({
      code: 'PT_ORDER_INVALID'
    })
    await expect(reorderPages(input, [1, 2], noEmit)).rejects.toMatchObject({
      code: 'PT_ORDER_INVALID'
    })
  })

  it('isValidOrder 边界', () => {
    expect(isValidOrder([2, 1], 2)).toBe(true)
    expect(isValidOrder([2, 1, 3], 3)).toBe(true)
    expect(isValidOrder([], 0)).toBe(true)
    expect(isValidOrder([1, 2, 2], 3)).toBe(false)
    expect(isValidOrder([0, 1], 2)).toBe(false)
  })
})

describe('pdf-ops 元数据', () => {
  it('写入后可回读，空字段保持原值', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 1)
    const result = await writeMetadata(
      input,
      { title: '新标题', author: ' 作者 ', subject: '主题', keywords: 'a,b' },
      noEmit
    )
    const info = await inspectPdf(result.outputPaths[0] as string)
    expect(info.metadata.title).toBe('新标题')
    expect(info.metadata.author).toBe('作者')
    expect(info.metadata.subject).toBe('主题')
    expect(info.metadata.keywords).toBe('a,b')
  })

  it('只写一项时其余字段保持原值', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 1)
    const result = await writeMetadata(input, { author: '仅作者' }, noEmit)
    const info = await inspectPdf(result.outputPaths[0] as string)
    expect(info.metadata.author).toBe('仅作者')
    expect(info.metadata.title).toBe('')
  })
})

describe('pdf-ops 读取与分发', () => {
  it('损坏文件 → PT_PDF_CORRUPT', async () => {
    const dir = await tempDir()
    const input = join(dir, '坏.pdf')
    await writeFile(input, 'not a pdf')
    await expect(inspectPdf(input)).rejects.toMatchObject({ code: 'PT_PDF_CORRUPT' })
  })

  it('路径是目录（非 ENOENT 读失败）→ PT_PDF_CORRUPT', async () => {
    const dir = await tempDir()
    const asDir = join(dir, '目录.pdf')
    await mkdir(asDir)
    await expect(inspectPdf(asDir)).rejects.toMatchObject({ code: 'PT_PDF_CORRUPT' })
  })

  it('runOp 分发八种 op', async () => {
    const dir = await tempDir()
    const a = join(dir, 'a.pdf')
    const b = join(dir, 'b.pdf')
    await makePdf(a, 2)
    await makePdf(b, 1)
    await expect(
      runOp({ op: 'merge', payload: { inputPaths: [a, b] } }, noEmit)
    ).resolves.toBeDefined()
    await expect(
      runOp({ op: 'split', payload: { inputPath: a, ranges: '1' } }, noEmit)
    ).resolves.toBeDefined()
    await expect(
      runOp({ op: 'delete', payload: { inputPath: a, ranges: '1' } }, noEmit)
    ).resolves.toBeDefined()
    await expect(
      runOp({ op: 'rotate', payload: { inputPath: a, degrees: 90 } }, noEmit)
    ).resolves.toBeDefined()
    await expect(
      runOp({ op: 'reorder', payload: { inputPath: a, order: [2, 1] } }, noEmit)
    ).resolves.toBeDefined()
    await expect(
      runOp({ op: 'metadata', payload: { inputPath: a, metadata: { title: 'T' } } }, noEmit)
    ).resolves.toBeDefined()
    await expect(
      runOp(
        {
          op: 'watermark',
          payload: {
            kind: 'text',
            inputPath: a,
            imageData: TINY_PNG_BASE64,
            opacity: 0.3,
            angle: 0,
            scale: 20,
            tile: false
          }
        },
        noEmit
      )
    ).resolves.toBeDefined()
    await expect(
      runOp(
        {
          op: 'page-numbers',
          payload: {
            inputPath: a,
            format: '{n}',
            position: 'bottom-center',
            startPage: 1,
            fontSize: 12,
            color: '#333333',
            margin: 24
          }
        },
        noEmit
      )
    ).resolves.toBeDefined()
  })
})

describe('pdf-ops 水印（M17）', () => {
  const textPayload = {
    kind: 'text' as const,
    inputPath: '',
    imageData: TINY_PNG_BASE64,
    opacity: 0.4,
    angle: 45,
    scale: 30,
    tile: false
  }

  it('hexToRgb 分量换算', () => {
    expect(hexToRgb('#ff8000').r).toBe(1)
    expect(hexToRgb('#ff8000').g).toBeCloseTo(0.50196, 4)
    expect(hexToRgb('#ff8000').b).toBe(0)
  })

  it('centerImageAnchor：0/45/90 度', () => {
    expect(centerImageAnchor(300, 400, 100, 50, 0)).toEqual({ x: 100, y: 175 })
    const right = centerImageAnchor(300, 400, 100, 50, 90)
    expect(right.x).toBeCloseTo(175, 6)
    expect(right.y).toBeCloseTo(150, 6)
    const diag = centerImageAnchor(300, 400, 100, 50, 45)
    expect(diag.x).toBeCloseTo(132.322, 2)
    expect(diag.y).toBeCloseTo(146.967, 2)
  })

  it('文字水印：默认全页 + 命名', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 3)
    const result = await watermarkPdf({ ...textPayload, inputPath: input }, noEmit)
    expect(result.outputPaths).toEqual([join(dir, '卷_水印.pdf')])
    const output = await PDFDocument.load(await readBytes(result.outputPaths[0] as string))
    expect(output.getPageCount()).toBe(3)
  })

  it('文字水印：平铺 + 页码范围 + 进度', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 3)
    const stages: number[] = []
    const result = await watermarkPdf(
      { ...textPayload, inputPath: input, tile: true, angle: 0, ranges: '2' },
      (update) => stages.push(update.current)
    )
    expect(result.outputPaths).toEqual([join(dir, '卷_水印.pdf')])
    expect(stages.length).toBeGreaterThan(0)
  })

  it('文字水印：损坏 base64 → PT_WATERMARK_INVALID', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 1)
    await expect(
      watermarkPdf({ ...textPayload, inputPath: input, imageData: 'bm90LXBuZw==' }, noEmit)
    ).rejects.toMatchObject({ code: 'PT_WATERMARK_INVALID' })
  })

  it('图片水印：PNG 文件可嵌入', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    const imagePath = join(dir, '印章.PNG')
    await makePdf(input, 2)
    await writeFile(imagePath, Buffer.from(TINY_PNG_BASE64, 'base64'))
    const result = await watermarkPdf(
      {
        kind: 'image',
        inputPath: input,
        imagePath,
        opacity: 0.5,
        angle: 0,
        scale: 20,
        tile: false
      },
      noEmit
    )
    expect(result.outputPaths).toEqual([join(dir, '卷_水印.pdf')])
  })

  it('图片水印：缺失/损坏/非法区间', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 1)
    const imageBase = {
      kind: 'image' as const,
      inputPath: input,
      opacity: 0.5,
      angle: 0,
      scale: 20,
      tile: false
    }
    await expect(
      watermarkPdf({ ...imageBase, imagePath: join(dir, '缺失.png') }, noEmit)
    ).rejects.toMatchObject({ code: 'PT_WATERMARK_INVALID' })

    const broken = join(dir, '坏.jpg')
    await writeFile(broken, 'not an image')
    await expect(
      watermarkPdf({ ...imageBase, imagePath: broken }, noEmit)
    ).rejects.toMatchObject({ code: 'PT_WATERMARK_INVALID' })

    const valid = join(dir, '印章.png')
    await writeFile(valid, Buffer.from(TINY_PNG_BASE64, 'base64'))
    await expect(
      watermarkPdf({ ...imageBase, imagePath: valid, ranges: '9' }, noEmit)
    ).rejects.toMatchObject({ code: 'PT_RANGE_INVALID' })
  })
})

describe('pdf-ops 页码（M17）', () => {
  const pagePayload = {
    inputPath: '',
    format: '{n}/{total}',
    position: 'bottom-center' as const,
    startPage: 1,
    fontSize: 12,
    color: '#333333',
    margin: 24
  }

  it('pageNumberText 替换占位符', () => {
    expect(pageNumberText('{n}/{total}', 2, 10)).toBe('2/10')
    expect(pageNumberText('- {n} -', 3, 5)).toBe('- 3 -')
    expect(pageNumberText('Page {n} of {total}', 1, 1)).toBe('Page 1 of 1')
  })

  it('pageNumberPosition：六个位置坐标', () => {
    const base = { pageWidth: 300, pageHeight: 300, textWidth: 60, fontSize: 12, margin: 24 }
    expect(
      pageNumberPosition('bottom-center', base.pageWidth, base.pageHeight, 60, 12, 24)
    ).toEqual({ x: 120, y: 24 })
    expect(
      pageNumberPosition('bottom-left', base.pageWidth, base.pageHeight, 60, 12, 24)
    ).toEqual({ x: 24, y: 24 })
    expect(
      pageNumberPosition('bottom-right', base.pageWidth, base.pageHeight, 60, 12, 24)
    ).toEqual({ x: 216, y: 24 })
    expect(
      pageNumberPosition('top-center', base.pageWidth, base.pageHeight, 60, 12, 24)
    ).toEqual({ x: 120, y: 264 })
    expect(pageNumberPosition('top-left', base.pageWidth, base.pageHeight, 60, 12, 24)).toEqual({
      x: 24,
      y: 264
    })
    expect(pageNumberPosition('top-right', base.pageWidth, base.pageHeight, 60, 12, 24)).toEqual({
      x: 216,
      y: 264
    })
  })

  it('默认全部页 + 命名', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 3)
    const result = await addPageNumbers({ ...pagePayload, inputPath: input }, noEmit)
    expect(result.outputPaths).toEqual([join(dir, '卷_页码.pdf')])
    const output = await PDFDocument.load(await readBytes(result.outputPaths[0] as string))
    expect(output.getPageCount()).toBe(3)
  })

  it('startPage=2：仅第 2 页起加页码', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 3)
    const currents: number[] = []
    const result = await addPageNumbers(
      { ...pagePayload, inputPath: input, startPage: 2 },
      (update) => {
        if (update.stage === 'process') currents.push(update.current)
      }
    )
    expect(result.outputPaths).toEqual([join(dir, '卷_页码.pdf')])
    expect(currents).toEqual([1, 2])
  })

  it('ranges 与 startPage 交集为空 → PT_PAGE_NUMBER_INVALID', async () => {
    const dir = await tempDir()
    const input = join(dir, '卷.pdf')
    await makePdf(input, 3)
    await expect(
      addPageNumbers({ ...pagePayload, inputPath: input, startPage: 3, ranges: '1-2' }, noEmit)
    ).rejects.toMatchObject({ code: 'PT_PAGE_NUMBER_INVALID' })
    await expect(
      addPageNumbers({ ...pagePayload, inputPath: input, ranges: '9' }, noEmit)
    ).rejects.toMatchObject({ code: 'PT_RANGE_INVALID' })
  })
})

/** 读取产物字节 */
async function readBytes(path: string): Promise<Uint8Array> {
  const { readFile } = await import('node:fs/promises')
  return readFile(path)
}
