// OCR 导出写失败分支（R2.7 磁盘满边界）：批内已写半成品尽力清理 + 结构化错误
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OcrDeps } from './ocr-ops'
import type { RenderedPage } from './ocr-render'
import type { OcrPage } from './schema'

const mocks = vi.hoisted(() => ({
  unlink: vi.fn(async (_path: string): Promise<void> => undefined),
  writeFile: vi.fn(async (_path: string, _data: Uint8Array): Promise<void> => undefined)
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, writeFile: mocks.writeFile, unlink: mocks.unlink }
})

const { runOcrOp } = await import('./ocr-ops')

let root = ''

function tempRoot(): string {
  if (root === '') root = mkdtempSync(join(tmpdir(), 'lumin-exam-ocr-writefail-'))
  return root
}

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  mocks.writeFile.mockReset()
  mocks.unlink.mockClear()
})

function solidPage(pageNumber: number): RenderedPage {
  const width = 100
  const height = 200
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  return { pageNumber, width, height, image: { data, width, height } }
}

/** 用同步 fs 建输入（writeFile 已被 mock，绕开） */
function makeInput(): { input: string; dir: string } {
  const dir = join(
    tempRoot(),
    `case-${mocks.writeFile.mock.calls.length}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  const input = join(dir, '写失败卷.png')
  writeFileSync(input, 'fake-image')
  return { input, dir }
}

const page: OcrPage = {
  pageNumber: 1,
  width: 100,
  height: 200,
  regions: [
    { start: 0, end: 0.5, lines: [] },
    { start: 0.5, end: 1, lines: [] }
  ]
}

function deps(): OcrDeps {
  return {
    render: async () => [solidPage(1)],
    createEngine: async () => {
      throw new Error('export 不应创建引擎')
    }
  }
}

function exportRequest(input: string): Parameters<typeof runOcrOp>[0] {
  return {
    op: 'export',
    payload: { inputPath: input, rotation: 0, startNumber: 1, exportPdf: false, pages: [page] }
  }
}

async function writeForReal(path: string, data: Uint8Array): Promise<void> {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  await actual.writeFile(path, data)
}

describe('OCR export 写失败分支（spec §10.7 + R2.7）', () => {
  it('磁盘满（ENOSPC）→ OUTPUT_WRITE_FAILED(detail=ENOSPC) 且清理批内已写文件', async () => {
    const { input, dir } = makeInput()
    mocks.writeFile.mockImplementationOnce(writeForReal)
    mocks.writeFile.mockRejectedValueOnce(
      Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
    )
    await expect(runOcrOp(exportRequest(input), deps(), () => undefined)).rejects.toMatchObject({
      code: 'OUTPUT_WRITE_FAILED',
      detail: 'ENOSPC'
    })
    // 本批已写的第 1 张 PNG 被清理（第 2 张未写成）
    const first = mocks.writeFile.mock.calls[0]?.[0] as string
    expect(first).toBe(join(dir, '写失败卷_题1.png'))
    expect(mocks.unlink).toHaveBeenCalledWith(first)
    expect(existsSync(first)).toBe(true) // unlink 被 mock：存在性由 mock 调用断言，不落真实删除
  })

  it('写后校验失败 → OUTPUT_WRITE_FAILED(detail=verify-failed) 且删除坏产物', async () => {
    const { input, dir } = makeInput()
    // writeFile 写入空内容 → PNG 头校验失败
    mocks.writeFile.mockImplementationOnce(async (path, _data) => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      await actual.writeFile(path, Buffer.alloc(0))
    })
    await expect(runOcrOp(exportRequest(input), deps(), () => undefined)).rejects.toMatchObject({
      code: 'OUTPUT_WRITE_FAILED',
      detail: 'verify-failed'
    })
    expect(mocks.unlink).toHaveBeenCalledTimes(1)
    const target = mocks.unlink.mock.calls[0]?.[0] as string
    expect(target).toBe(join(dir, '写失败卷_题1.png'))
  })

  it('正常写入路径不触发清理（两张 PNG 落盘）', async () => {
    const { input, dir } = makeInput()
    mocks.writeFile.mockImplementation(writeForReal)
    const result = await runOcrOp(exportRequest(input), deps(), () => undefined)
    expect((result as { outputPaths: string[] }).outputPaths).toEqual([
      join(dir, '写失败卷_题1.png'),
      join(dir, '写失败卷_题2.png')
    ])
    expect(mocks.unlink).not.toHaveBeenCalled()
  })
})
