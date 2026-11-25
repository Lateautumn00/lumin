/**
 * @file archive.worker.test.ts worker 协议编排单测
 * @author cuilanchao
 * @date 2026-11-20
 * @description 进度适配（空消息省略）与 mode 分派（真实临时目录跑通打包→解压）
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TaskRunContext } from '@lumin/node-kit'
import type { TaskUpdate } from '@lumin/shared'
import { handleArchiveTask, toProgressEmitter } from './archive.worker'
import type { PackResult, UnpackResult } from './schema'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lumin-zip-worker-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function context(): { updates: TaskUpdate[]; ctx: TaskRunContext } {
  const updates: TaskUpdate[] = []
  return { updates, ctx: { emit: (update) => updates.push(update) } }
}

describe('toProgressEmitter', () => {
  it('有消息带 message；空串省略 message', () => {
    const { updates, ctx } = context()
    const emit = toProgressEmitter(ctx)
    emit({ current: 1, total: 2, stage: 'pack', message: 'a.txt' })
    emit({ current: 2, total: 2, stage: 'pack', message: '' })
    emit({ current: 2, total: 2, stage: 'unpack' })
    expect(updates).toEqual([
      { kind: 'progress', current: 1, total: 2, stage: 'pack', message: 'a.txt' },
      { kind: 'progress', current: 2, total: 2, stage: 'pack' },
      { kind: 'progress', current: 2, total: 2, stage: 'unpack' }
    ])
  })
})

describe('handleArchiveTask', () => {
  it('pack 模式产出压缩包，unpack 模式回读内容', async () => {
    const root = tempRoot()
    const source = join(root, '源.txt')
    writeFileSync(source, '内容', 'utf8')

    const packing = context()
    const packed = await handleArchiveTask(
      { mode: 'pack', payload: { sources: [source], outputDir: root, outputName: '包.zip' } },
      packing.ctx
    )
    const packResult = packed as PackResult
    expect(packResult.files).toBe(1)
    expect(
      packing.updates.every((update) => update.kind !== 'progress' || update.stage === 'pack')
    ).toBe(true)

    const unpacking = context()
    const unpacked = await handleArchiveTask(
      {
        mode: 'unpack',
        payload: {
          archive: packResult.outputZip,
          targetDir: join(root, '解压'),
          conflict: 'rename'
        }
      },
      unpacking.ctx
    )
    const unpackResult = unpacked as UnpackResult
    expect(unpackResult.files).toBe(1)
    expect(unpackResult.skipped).toBe(0)
    expect(unpacking.updates.at(-1)).toMatchObject({ kind: 'progress', stage: 'unpack' })
  })
})
