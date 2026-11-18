import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterAll, describe, expect, it } from 'vitest'
import type { OcrEngine } from './ocr-model'
import {
  runOcrOp,
  type OcrDeps,
  type OcrEmit,
  type OcrProgress,
  type OcrWorkerRequest
} from './ocr-ops'
import type { RenderedPage } from './ocr-render'
import type { OcrLine, OcrPage } from './schema'

let root = ''
let dirSeq = 0

/** 每个用例独立目录（避免产物互相干扰） */
function tempDir(prefix = 'out'): string {
  if (root === '') root = mkdtempSync(join(tmpdir(), 'lumin-exam-ocr-ops-'))
  dirSeq += 1
  const dir = join(root, `${prefix}-${dirSeq}`)
  mkdirSync(dir, { recursive: true })
  return dir
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

/** 全白 RGBA 页（导出裁剪/编码只需合法像素） */
function solidPage(pageNumber: number, width = 100, height = 200): RenderedPage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  return { pageNumber, width, height, image: { data, width, height } }
}

function collect(): { updates: OcrProgress[]; emit: OcrEmit } {
  const updates: OcrProgress[] = []
  return { updates, emit: (update) => updates.push(update) }
}

function lineAt(text: string, y: number): OcrLine {
  return { text, x: 0.05, y, width: 0.5, height: 0.05 }
}

/** 假引擎：按调用顺序依次返回行集（超出取最后一份） */
function engineOf(sequence: readonly OcrLine[][]): OcrEngine {
  let index = 0
  return {
    detectLines: async () => {
      const lines = sequence[Math.min(index, sequence.length - 1)] ?? []
      index += 1
      return lines
    }
  }
}

/** detect 请求（binariesDir 只在 worker 内使用） */
function detectRequest(inputPath = '卷.pdf'): OcrWorkerRequest {
  return { op: 'detect', payload: { inputPath, rotation: 0 }, binariesDir: '/bin/ocr' }
}

/** 单页题区（默认 2 题，全宽纵向对半） */
function regionPage(pageNumber: number, regions = 2): OcrPage {
  const list = Array.from({ length: regions }, (_, i) => ({
    start: i / regions,
    end: (i + 1) / regions,
    lines: []
  }))
  return { pageNumber, width: 100, height: 200, regions: list }
}

function exportRequest(
  inputPath: string,
  overrides: Partial<Record<string, unknown>> = {}
): OcrWorkerRequest {
  return {
    op: 'export',
    payload: {
      inputPath,
      rotation: 0,
      startNumber: 1,
      exportPdf: false,
      pages: [regionPage(1)],
      ...overrides
    }
  } as OcrWorkerRequest
}

function makeInput(name = '卷.png'): string {
  const path = join(tempDir('in'), name)
  writeFileSync(path, 'fake-image')
  return path
}

describe('runOcrOp · detect（spec §10.4 阶段口径）', () => {
  it('render → detect(加载模型) → 每页 detect/cluster；返回每页题区', async () => {
    const pages = [solidPage(1), solidPage(2)]
    const deps: OcrDeps = {
      render: async (_path, options = {}) => {
        options.onPage?.(0, pages.length)
        options.onPage?.(1, pages.length)
        options.onPage?.(2, pages.length)
        return pages
      },
      createEngine: async () =>
        engineOf([[lineAt('1、第一题', 0.1), lineAt('2、第二题', 0.6)], [lineAt('1、页二题', 0.1)]])
    }
    const { updates, emit } = collect()
    const result = await runOcrOp(detectRequest(), deps, emit)

    expect(updates.map((update) => update.stage)).toEqual([
      'render',
      'render',
      'render',
      'detect',
      'detect',
      'cluster',
      'detect',
      'cluster'
    ])
    expect(updates[0]).toMatchObject({ stage: 'render', current: 0, total: 2 })
    expect(updates[3]).toMatchObject({
      stage: 'detect',
      current: 0,
      total: 2,
      message: '加载识别模型…'
    })
    expect(result).toMatchObject({
      pages: [
        { pageNumber: 1, regions: [{}, {}] },
        { pageNumber: 2, regions: [{}] }
      ]
    })
  })

  it('全页 0 题区 → NO_REGIONS（spec §10.5）', async () => {
    const deps: OcrDeps = {
      render: async () => [solidPage(1)],
      createEngine: async () => engineOf([[]])
    }
    await expectCode(() => runOcrOp(detectRequest(), deps, () => undefined), 'NO_REGIONS')
  })

  it('空 regions 页保留（仅当全部页皆空才 NO_REGIONS）', async () => {
    const deps: OcrDeps = {
      render: async () => [solidPage(1), solidPage(2)],
      createEngine: async () => engineOf([[lineAt('1、有题', 0.2)], []])
    }
    const result = await runOcrOp(detectRequest(), deps, () => undefined)
    expect(result).toMatchObject({
      pages: [
        { pageNumber: 1, regions: [{}] },
        { pageNumber: 2, regions: [] }
      ]
    })
  })

  it('createEngine 抛结构化 MODEL_MISSING → 原样透传', async () => {
    const structured = { code: 'MODEL_MISSING', message: '识别模型缺失' }
    const deps: OcrDeps = {
      render: async () => [solidPage(1)],
      createEngine: async () => Promise.reject(structured)
    }
    await expect(runOcrOp(detectRequest(), deps, () => undefined)).rejects.toBe(structured)
  })

  it('推理期普通异常 → OCR_FAILED（detail 带消息尾部）', async () => {
    const deps: OcrDeps = {
      render: async () => [solidPage(1)],
      createEngine: async () => ({
        detectLines: async () => Promise.reject(new Error('ort boom'))
      })
    }
    await expect(runOcrOp(detectRequest(), deps, () => undefined)).rejects.toMatchObject({
      code: 'OCR_FAILED',
      detail: expect.stringContaining('ort boom')
    })
  })

  it('推理期结构化错误 → 原样透传', async () => {
    const structured = { code: 'OCR_FAILED', message: '识别失败' }
    const deps: OcrDeps = {
      render: async () => [solidPage(1)],
      createEngine: async () => ({ detectLines: async () => Promise.reject(structured) })
    }
    await expect(runOcrOp(detectRequest(), deps, () => undefined)).rejects.toBe(structured)
  })

  it('推理期抛出非 Error（字符串）→ OCR_FAILED（String 分支）', async () => {
    const deps: OcrDeps = {
      render: async () => [solidPage(1)],
      createEngine: async () => ({ detectLines: async () => Promise.reject('odd-failure') })
    }
    await expect(runOcrOp(detectRequest(), deps, () => undefined)).rejects.toMatchObject({
      code: 'OCR_FAILED',
      detail: expect.stringContaining('odd-failure')
    })
  })

  it('渲染期结构化错误 → 原样透传（PDF_ENCRYPTED 等）', async () => {
    const structured = { code: 'PDF_ENCRYPTED', message: 'PDF 已加密' }
    const deps: OcrDeps = {
      render: async () => Promise.reject(structured),
      createEngine: async () => engineOf([[]])
    }
    await expect(runOcrOp(detectRequest(), deps, () => undefined)).rejects.toBe(structured)
  })
})

describe('runOcrOp · export（spec §10.7）', () => {
  it('按页序+题序连续编号写出 PNG（startNumber 起）', async () => {
    const input = makeInput()
    const deps: OcrDeps = {
      render: async (_path, options = {}) => {
        expect(options.pageNumbers).toEqual([1, 2])
        return [solidPage(1), solidPage(2)]
      },
      createEngine: async () => {
        throw new Error('export 不应创建引擎')
      }
    }
    const { updates, emit } = collect()
    const request = exportRequest(input, {
      startNumber: 3,
      pages: [regionPage(1), regionPage(2)]
    })
    const result = await runOcrOp(request, deps, emit)

    const dir = dirname(input)
    expect(result).toEqual({
      outputPaths: [
        join(dir, '卷_题3.png'),
        join(dir, '卷_题4.png'),
        join(dir, '卷_题5.png'),
        join(dir, '卷_题6.png')
      ]
    })
    for (const path of (result as { outputPaths: string[] }).outputPaths) {
      expect(readFileSync(path).subarray(0, 4).toString('hex')).toBe('89504e47')
    }
    expect(existsSync(join(dir, '卷_切题.pdf'))).toBe(false)
    // export 进度只有 write 阶段、不带 message（spec §10.4）
    expect(updates.every((update) => update.stage === 'write')).toBe(true)
    expect(updates.every((update) => update.message === undefined)).toBe(true)
    expect(updates.at(-1)).toMatchObject({ current: 4, total: 4 })
  })

  it('exportPdf → 追加 {原名}_切题.pdf，页数 = 题数、头 %PDF-（spec §10.7）', async () => {
    const input = makeInput()
    const deps: OcrDeps = {
      render: async () => [solidPage(1), solidPage(2)],
      createEngine: async () => engineOf([[]])
    }
    const { updates, emit } = collect()
    const result = await runOcrOp(
      exportRequest(input, { exportPdf: true, pages: [regionPage(1), regionPage(2)] }),
      deps,
      emit
    )
    const paths = (result as { outputPaths: string[] }).outputPaths
    const pdfPath = paths.at(-1) as string
    expect(pdfPath).toBe(join(dirname(input), '卷_切题.pdf'))
    const bytes = readFileSync(pdfPath)
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(4)
    // 合成页尺寸 = 像素 ÷ 渲染倍率（spec §10.1 回写口径）
    const page = doc.getPages()[0]!
    expect(page.getWidth()).toBeCloseTo(100 / 1.5, 5)
    expect(page.getHeight()).toBeCloseTo(100 / 1.5, 5)
    expect(updates.at(-1)).toMatchObject({ current: 5, total: 5 })
  })

  it('目标名冲突 → 递增 (1)（复用 node-kit resolveConflictPath）', async () => {
    const input = makeInput()
    writeFileSync(join(dirname(input), '卷_题1.png'), 'occupied')
    const deps: OcrDeps = {
      render: async () => [solidPage(1)],
      createEngine: async () => engineOf([[]])
    }
    const result = await runOcrOp(
      exportRequest(input, { pages: [regionPage(1, 1)] }),
      deps,
      () => undefined
    )
    expect((result as { outputPaths: string[] }).outputPaths).toEqual([
      join(dirname(input), '卷_题1(1).png')
    ])
  })

  it('渲染页与 payload 不匹配 → INVALID_PAYLOAD（不落任何半成品）', async () => {
    const input = makeInput()
    const deps: OcrDeps = {
      render: async () => [solidPage(1)],
      createEngine: async () => engineOf([[]])
    }
    await expectCode(
      () => runOcrOp(exportRequest(input, { pages: [regionPage(2)] }), deps, () => undefined),
      'INVALID_PAYLOAD'
    )
    expect(existsSync(join(dirname(input), '卷_题1.png'))).toBe(false)
  })

  it('渲染期普通异常 → INVALID_PAYLOAD；结构化 → 透传', async () => {
    const input = makeInput()
    const structured = { code: 'PDF_LOCKED', message: '文件被占用' }
    const failing: OcrDeps = {
      render: async () => Promise.reject(structured),
      createEngine: async () => engineOf([[]])
    }
    await expect(runOcrOp(exportRequest(input), failing, () => undefined)).rejects.toBe(structured)

    const plain: OcrDeps = {
      render: async () => Promise.reject(new Error('boom')),
      createEngine: async () => engineOf([[]])
    }
    await expectCode(
      () => runOcrOp(exportRequest(input), plain, () => undefined),
      'INVALID_PAYLOAD'
    )
  })

  it('区域越界 → cropRgbaRegion 夹到图内（不抛错）', async () => {
    const input = makeInput()
    const deps: OcrDeps = {
      render: async () => [solidPage(1)],
      createEngine: async () => engineOf([[]])
    }
    const page: OcrPage = {
      pageNumber: 1,
      width: 100,
      height: 200,
      regions: [{ start: 0, end: 1, xStart: 0, xEnd: 1, lines: [] }]
    }
    const result = await runOcrOp(exportRequest(input, { pages: [page] }), deps, () => undefined)
    expect((result as { outputPaths: string[] }).outputPaths).toHaveLength(1)
  })
})
