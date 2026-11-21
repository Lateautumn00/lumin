import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { cropPages, runOp, splitPdf, type OpProgress } from './pdf-ops'

const ENCRYPTED_FIXTURE = new URL('../fixtures/encrypted.pdf', import.meta.url).pathname.replace(
  /^\//,
  ''
)

let root = ''

function tempRoot(): string {
  if (root === '') {
    root = mkdtempSync(join(tmpdir(), 'lumin-exam-ops-'))
  }
  return root
}

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true })
})

/** 生成 n 页 PDF（每页带可辨内容） */
async function makePdf(name: string, pageCount: number): Promise<string> {
  const dir = join(tempRoot(), 'in')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  const doc = await PDFDocument.create()
  for (let index = 0; index < pageCount; index += 1) {
    const page = doc.addPage([612, 792])
    page.drawText(`page-${index + 1}`, { x: 24, y: 740, size: 14 })
  }
  writeFileSync(path, await doc.save())
  return path
}

async function pageCount(path: string): Promise<number> {
  const doc = await PDFDocument.load(await readFileBytes(path))
  return doc.getPageCount()
}

async function readFileBytes(path: string): Promise<Uint8Array> {
  const { readFile } = await import('node:fs/promises')
  return readFile(path)
}

function collect(): { updates: OpProgress[]; emit: (update: OpProgress) => void } {
  const updates: OpProgress[] = []
  return { updates, emit: (update) => updates.push(update) }
}

function expectCode(run: () => Promise<unknown>, code: string): Promise<void> {
  return run().then(
    () => Promise.reject(new Error(`应当抛 ${code}`)),
    (err: unknown) => {
      expect(err).toMatchObject({ code })
    }
  )
}

describe('splitPdf', () => {
  it('每区间一产物，页数与命名正确（spec §3.2/§7.2）', async () => {
    const input = await makePdf('试卷 A.pdf', 5)
    const { updates, emit } = collect()
    const result = await splitPdf(input, '1-2,4-5', emit)
    expect(result.outputPaths).toEqual([
      join(tempRoot(), 'in', '试卷 A_p1-2.pdf'),
      join(tempRoot(), 'in', '试卷 A_p4-5.pdf')
    ])
    expect(await pageCount(result.outputPaths[0]!)).toBe(2)
    expect(await pageCount(result.outputPaths[1]!)).toBe(2)
    expect(updates[0]?.stage).toBe('load')
    expect(updates.at(-1)).toMatchObject({ stage: 'done', current: 2, total: 2 })
    expect(updates.some((update) => update.stage === 'process')).toBe(true)
    expect(updates.some((update) => update.stage === 'write')).toBe(true)
  })

  it('产物冲突递增 (1)（spec §7.3）', async () => {
    const input = await makePdf('冲突卷.pdf', 2)
    const first = await splitPdf(input, '1-2', () => undefined)
    const second = await splitPdf(input, '1-2', () => undefined)
    expect(first.outputPaths[0]).toContain('冲突卷_p1-2.pdf')
    expect(second.outputPaths[0]).toContain('冲突卷_p1-2(1).pdf')
    expect(existsSync(second.outputPaths[0]!)).toBe(true)
  })

  it('越界区间 → RANGE_INVALID（不产出任何文件）', async () => {
    const input = await makePdf('越界卷.pdf', 3)
    await expectCode(() => splitPdf(input, '1-99', () => undefined), 'RANGE_INVALID')
  })
})

describe('cropPages', () => {
  it('按比例逐页应用 CropBox 并翻转到左下原点（spec §1）', async () => {
    const input = await makePdf('裁剪卷.pdf', 2)
    const result = await cropPages(
      input,
      '1',
      { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      () => undefined
    )
    const doc = await PDFDocument.load(await readFileBytes(result.outputPaths[0]!))
    const crop = doc.getPage(0).getCropBox()
    expect(crop.x).toBeCloseTo(61.2, 3)
    expect(crop.width).toBeCloseTo(306, 3)
    expect(crop.height).toBeCloseTo(396, 3)
    expect(crop.y).toBeCloseTo(792 * 0.4, 3)
    // 未选中页保持整页
    const untouched = doc.getPage(1).getCropBox()
    expect(untouched.width).toBeCloseTo(612, 3)
    expect(untouched.height).toBeCloseTo(792, 3)
  })
})

describe('错误映射（spec §5）', () => {
  it('不存在 → PDF_NOT_FOUND', async () => {
    await expectCode(
      () => splitPdf(join(tempRoot(), 'in', '缺失卷.pdf'), '1', () => undefined),
      'PDF_NOT_FOUND'
    )
  })

  it('非 PDF 内容 → PDF_INVALID', async () => {
    const dir = join(tempRoot(), 'in')
    const path = join(dir, '假 PDF.pdf')
    writeFileSync(path, '这不是 PDF')
    await expectCode(() => splitPdf(path, '1', () => undefined), 'PDF_INVALID')
  })

  it('加密 PDF → PDF_ENCRYPTED（spike §4 消息嗅探）', async () => {
    await expectCode(() => splitPdf(ENCRYPTED_FIXTURE, '1', () => undefined), 'PDF_ENCRYPTED')
  })

  it('命名冲突 99 次耗尽 → OUTPUT_WRITE_FAILED（detail=conflict-exhausted）', async () => {
    const input = await makePdf('耗尽卷.pdf', 1)
    const dir = join(tempRoot(), 'in')
    writeFileSync(join(dir, '耗尽卷_p1.pdf'), 'x')
    for (let index = 1; index <= 99; index += 1) {
      writeFileSync(join(dir, `耗尽卷_p1(${index}).pdf`), 'x')
    }
    try {
      await splitPdf(input, '1', () => undefined)
      expect.unreachable('应当抛 OUTPUT_WRITE_FAILED')
    } catch (err) {
      expect(err).toMatchObject({ code: 'OUTPUT_WRITE_FAILED', detail: 'conflict-exhausted' })
    }
  })
})

describe('性能（R5/plan §4.4）', () => {
  it('100 页拆分 < 2s', async () => {
    const input = await makePdf('百页卷.pdf', 100)
    const ranges = Array.from(
      { length: 10 },
      (_, index) => `${index * 10 + 1}-${index * 10 + 10}`
    ).join(',')
    const started = Date.now()
    const result = await splitPdf(input, ranges, () => undefined)
    const elapsed = Date.now() - started
    expect(result.outputPaths).toHaveLength(10)
    expect(await pageCount(result.outputPaths[9]!)).toBe(10)
    expect(elapsed).toBeLessThan(2000)
  }, 10_000)
})

describe('runOp（worker 分发入口，spec §4）', () => {
  it('两算子按 op 分发到对应实现', async () => {
    const a = await makePdf('dispatch-a.pdf', 3)
    const { emit } = collect()

    const split = await runOp({ op: 'split', payload: { inputPath: a, ranges: '1,2' } }, emit)
    expect(split.outputPaths).toHaveLength(2)

    const cropped = await runOp(
      { op: 'crop', payload: { inputPath: a, box: { x: 0, y: 0, width: 0.5, height: 0.5 } } },
      emit
    )
    expect(cropped.outputPaths).toHaveLength(1)
  })
})
