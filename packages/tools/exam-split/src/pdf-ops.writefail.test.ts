// 写产物失败分支（R2.7 磁盘满边界）：截断半成品尽力清理 + 结构化错误
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

const mocks = vi.hoisted(() => ({
  unlink: vi.fn(async (_path: string): Promise<void> => undefined),
  writeFile: vi.fn(async (_path: string, _data: Uint8Array): Promise<void> => undefined)
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, writeFile: mocks.writeFile, unlink: mocks.unlink }
})

const { splitPdf } = await import('./pdf-ops')

let root = ''

function tempRoot(): string {
  if (root === '') root = mkdtempSync(join(tmpdir(), 'lumin-exam-writefail-'))
  return root
}

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  mocks.writeFile.mockReset()
  mocks.unlink.mockClear()
})

/** 用同步 fs 建输入（writeFile 已被 mock，绕开） */
async function makeInput(): Promise<string> {
  const path = join(tempRoot(), '写失败卷.pdf')
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  writeFileSync(path, await doc.save())
  return path
}

describe('writeOutput 失败分支（spec §7.4 + R2.7）', () => {
  it('磁盘满（ENOSPC）→ OUTPUT_WRITE_FAILED(detail=ENOSPC) 且清理截断半成品', async () => {
    const input = await makeInput()
    mocks.writeFile.mockRejectedValueOnce(
      Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
    )
    await expect(splitPdf(input, '1', () => undefined)).rejects.toMatchObject({
      code: 'OUTPUT_WRITE_FAILED',
      detail: 'ENOSPC'
    })
    expect(mocks.unlink).toHaveBeenCalledTimes(1)
    const written = mocks.writeFile.mock.calls[0]?.[0] ?? ''
    expect(existsSync(written)).toBe(false)
  })

  it('写后校验失败 → OUTPUT_WRITE_FAILED(detail=verify-failed) 且删除坏产物', async () => {
    const input = await makeInput()
    // writeFile 写入非 %PDF- 内容 → verifyWritten 失败
    mocks.writeFile.mockImplementationOnce(async (path, data) => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      await actual.writeFile(path, Buffer.from('NOT-P').subarray(0, 0))
      void data
    })
    await expect(splitPdf(input, '1', () => undefined)).rejects.toMatchObject({
      code: 'OUTPUT_WRITE_FAILED',
      detail: 'verify-failed'
    })
    expect(mocks.unlink).toHaveBeenCalledTimes(1)
  })

  it('正常写入路径不触发清理', async () => {
    const input = await makeInput()
    mocks.writeFile.mockImplementationOnce(async (path, data) => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      await actual.writeFile(path, data as Uint8Array)
    })
    const result = await splitPdf(input, '1', () => undefined)
    expect(result.outputPaths).toHaveLength(1)
    expect(mocks.unlink).not.toHaveBeenCalled()
  })
})
