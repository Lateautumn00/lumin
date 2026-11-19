import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import type { TaskRunContext } from '@lumin/node-kit'
import { afterAll, describe, expect, it } from 'vitest'
import { handleTask } from './pdf.worker'

const roots: string[] = []

/** 造一页 PDF */
async function makePdf(path: string): Promise<void> {
  const doc = await PDFDocument.create()
  doc.addPage([300, 400])
  await writeFile(path, await doc.save())
}

afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('pdf.worker handleTask', () => {
  it('执行 op 并把进度转成 task 事件', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lumin-pt-worker-'))
    roots.push(dir)
    const input = join(dir, '卷.pdf')
    await makePdf(input)
    const updates: unknown[] = []
    const ctx = { emit: (update: unknown) => updates.push(update) } as unknown as TaskRunContext
    const result = await handleTask(
      { op: 'rotate', payload: { inputPath: input, degrees: 180 } },
      ctx
    )
    expect(result.outputPaths).toEqual([join(dir, '卷_旋转180.pdf')])
    expect(updates.length).toBeGreaterThan(0)
    expect(updates[0]).toMatchObject({ kind: 'progress', stage: 'load' })
  })
})
