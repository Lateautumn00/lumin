import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { TaskUpdate } from '@lumin/shared'
import { PDFDocument } from 'pdf-lib'
import { handleTask } from './pdf.worker'

let root = ''

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true })
})

async function makePdf(name: string, pageCount: number): Promise<string> {
  const dir = join(tempRoot(), 'in')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  const doc = await PDFDocument.create()
  for (let index = 0; index < pageCount; index += 1) doc.addPage([612, 792])
  writeFileSync(path, await doc.save())
  return path
}

function tempRoot(): string {
  if (root === '') root = mkdtempSync(join(tmpdir(), 'lumin-exam-worker-'))
  return root
}

describe('pdf.worker handleTask（exposeTask 回调）', () => {
  it('非 worker 环境导入无副作用，进度经 ctx.emit 上抛并返回产物', async () => {
    const input = await makePdf('worker.pdf', 2)
    const updates: TaskUpdate[] = []
    const result = await handleTask(
      {
        op: 'crop',
        payload: { inputPath: input, box: { x: 0, y: 0, width: 0.5, height: 0.5 } }
      },
      { emit: (update) => updates.push(update) }
    )
    expect(result.outputPaths).toHaveLength(1)
    const stages = updates.filter((update) => update.kind === 'progress')
    expect(stages.length).toBeGreaterThan(0)
    expect(stages[0]).toMatchObject({ kind: 'progress', stage: 'load' })
  })
})
