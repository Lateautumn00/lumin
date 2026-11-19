import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterAll, describe, expect, it } from 'vitest'
import {
  deletePages,
  inspectPdf,
  isValidOrder,
  mergePdf,
  reorderPages,
  rotatePages,
  runOp,
  splitPdf,
  writeMetadata
} from './pdf-ops'

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

  it('runOp 分发六种 op', async () => {
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
  })
})

/** 读取产物字节 */
async function readBytes(path: string): Promise<Uint8Array> {
  const { readFile } = await import('node:fs/promises')
  return readFile(path)
}
