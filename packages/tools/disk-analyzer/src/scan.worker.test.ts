/**
 * @file scan.worker.test.ts 递归聚合真实临时目录单测
 * @author cuilanchao
 * @date 2026-11-20
 * @description 覆盖子目录汇总/排序/上限/根目录非法/空目录/进度/中文空格路径/子目录不可读（spec §5.3）
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TaskRunContext } from '@lumin/node-kit'
import type { TaskUpdate } from '@lumin/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { accumulateType, aggregateDirectory, runScan, type ScanCounters } from './scan.worker'
import type { ScanRequest } from './schema'

/** 临时目录列表（afterEach 清理） */
const tempDirs: string[] = []

/** 建临时目录并写入文件（键为相对路径） */
async function setup(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lumin-da-'))
  tempDirs.push(root)
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, content)
  }
  return root
}

/** 收集进度的假任务上下文 */
function createCtx(): { ctx: TaskRunContext; updates: TaskUpdate[] } {
  const updates: TaskUpdate[] = []
  return { ctx: { emit: (update) => updates.push(update) }, updates }
}

/** 空计数 */
function emptyCounters(): ScanCounters {
  return { seen: 0, files: 0, dirs: 0, skipped: 0 }
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop() as string
    await rm(dir, { recursive: true, force: true })
  }
})

function request(root: string, minFileBytes = 0): ScanRequest {
  return { root, minFileBytes }
}

describe('accumulateType', () => {
  it('按小写扩展名累计文件数与字节，无扩展名归 (无扩展名)', () => {
    const totals = new Map<string, { files: number; bytes: number }>()
    accumulateType(totals, 'A.TXT', 10)
    accumulateType(totals, 'b.txt', 5)
    accumulateType(totals, 'README', 3)
    expect(totals.get('txt')).toEqual({ files: 2, bytes: 15 })
    expect(totals.get('(无扩展名)')).toEqual({ files: 1, bytes: 3 })
  })
})

describe('aggregateDirectory', () => {
  it('递归汇总后代文件大小与文件数，访问目录计数', async () => {
    const root = await setup({
      'sub/b.txt': 'abc',
      'sub/deep/c.txt': 'de'
    })
    const counters = emptyCounters()
    const result = await aggregateDirectory(join(root, 'sub'), counters, () => undefined)
    expect(result).toEqual({ size: 5, fileCount: 2 })
    expect(counters).toMatchObject({ seen: 2, files: 2, dirs: 2, skipped: 0 })
  })

  it('子目录不可读计入 skipped 且不中断（返回 0）', async () => {
    const root = await setup({})
    const counters = emptyCounters()
    const result = await aggregateDirectory(join(root, 'missing'), counters, () => undefined)
    expect(result).toEqual({ size: 0, fileCount: 0 })
    expect(counters).toMatchObject({ dirs: 1, skipped: 1, seen: 0 })
  })
})

describe('runScan', () => {
  it('按直接子项聚合，大小降序 + 同大小目录优先', async () => {
    const root = await setup({
      'a.txt': 'hello',
      'sub/b.txt': 'abc',
      'sub/deep/c.txt': 'de',
      'sub2/d.bin': '0123456789'
    })
    const { ctx } = createCtx()
    const result = await runScan(request(root), ctx, () => 1234)

    expect(result.entries.map((entry) => entry.name)).toEqual(['sub2', 'sub', 'a.txt'])
    expect(result.entries[0]).toMatchObject({ kind: 'dir', size: 10, fileCount: 1 })
    expect(result.entries[1]).toMatchObject({ kind: 'dir', size: 5, fileCount: 2 })
    expect(result.entries[2]).toMatchObject({ kind: 'file', size: 5, fileCount: 0 })
    expect(result).toMatchObject({
      totalBytes: 20,
      fileCount: 4,
      dirCount: 3,
      skipped: 0,
      elapsedMs: 0
    })
    expect(result.typeStats).toEqual([
      { ext: 'txt', files: 3, bytes: 10 },
      { ext: 'bin', files: 1, bytes: 10 }
    ])
  })

  it('类型统计覆盖子目录与无扩展名文件', async () => {
    const root = await setup({
      'a.txt': 'abc',
      'b.TXT': 'de',
      'README': 'x',
      'sub/c.png': '12345'
    })
    const { ctx } = createCtx()
    const result = await runScan(request(root), ctx, () => 0)
    expect(result.typeStats).toEqual([
      { ext: 'txt', files: 2, bytes: 5 },
      { ext: 'png', files: 1, bytes: 5 },
      { ext: '(无扩展名)', files: 1, bytes: 1 }
    ])
  })

  it('空目录返回空条目与 0 汇总，并推送起始进度', async () => {
    const root = await setup({})
    const { ctx, updates } = createCtx()
    const result = await runScan(request(root), ctx, () => 1000)
    expect(result).toMatchObject({ entries: [], totalBytes: 0, fileCount: 0, dirCount: 0 })
    expect(updates[0]).toMatchObject({ kind: 'progress', current: 0, stage: 'scan' })
  })

  it('中文与空格路径正常聚合', async () => {
    const root = await setup({
      '作业 资料/试卷 一.txt': 'abcd',
      '根 文件.txt': 'xy'
    })
    const { ctx } = createCtx()
    const result = await runScan(request(root), ctx, () => 0)
    const names = result.entries.map((entry) => entry.name)
    expect(names).toContain('作业 资料')
    expect(names).toContain('根 文件.txt')
    expect(result.totalBytes).toBe(6)
    expect(result.dirCount).toBe(1)
  })

  it('普通文件数超过上限 → DA_TOO_MANY_FILES', async () => {
    const root = await setup({ 'a.txt': 'a', 'b.txt': 'b' })
    const { ctx } = createCtx()
    await expect(runScan(request(root), ctx, () => 0, 1)).rejects.toMatchObject({
      code: 'DA_TOO_MANY_FILES'
    })
  })

  it('根目录不存在 → DA_ROOT_INVALID', async () => {
    const { ctx } = createCtx()
    await expect(
      runScan(request(join(tmpdir(), 'lumin-da-not-exist-2026')), ctx)
    ).rejects.toMatchObject({ code: 'DA_ROOT_INVALID' })
  })

  it('每 200 个文件推送一次进度', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 200; index += 1) files[`f${index}.txt`] = `${index}`
    const root = await setup(files)
    const { ctx, updates } = createCtx()
    const result = await runScan(request(root), ctx, () => 0)
    expect(result.fileCount).toBe(200)
    const counts = updates
      .filter((update) => update.kind === 'progress')
      .map((update) => (update.kind === 'progress' ? update.current : -1))
    expect(counts).toEqual([0, 200])
  })
})
