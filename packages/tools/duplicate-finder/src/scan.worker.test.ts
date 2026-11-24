/**
 * @file scan.worker.test.ts 扫描/两段哈希真实临时目录单测
 * @author cuilanchao
 * @date 2026-11-19
 * @description 覆盖递归/阈值/前缀预筛分化/空文件/上限/根目录非法/进度阶段（spec §5）
 */
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashFileRange, type TaskRunContext } from '@lumin/node-kit'
import type { TaskUpdate } from '@lumin/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { collectFiles, runScan } from './scan.worker'
import { PARTIAL_BYTES, type ScanRequest } from './schema'

/** 临时目录列表（afterEach 清理） */
const tempDirs: string[] = []

/** 建临时目录并写入文件（键为相对路径） */
async function setup(files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lumin-df-'))
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

/** SHA-256（十六进制） */
function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop() as string
    await rm(dir, { recursive: true, force: true })
  }
})

describe('collectFiles', () => {
  it('递归收集普通文件并按阈值过滤，统计检查数', async () => {
    const root = await setup({
      'a.txt': 'hello',
      'sub/b.txt': 'hello',
      'tiny.txt': 'x'
    })
    const result = await collectFiles(root, true, 5, () => undefined)
    expect(result.scannedFiles).toBe(3)
    expect(result.skipped).toBe(0)
    expect(result.entries.map((entry) => entry.path).sort()).toEqual(
      [join(root, 'a.txt'), join(root, 'sub', 'b.txt')].sort()
    )
    expect(result.entries[0]?.size).toBe(5)
  })

  it('非递归只扫描根目录一层', async () => {
    const root = await setup({ 'a.txt': 'hello', 'sub/b.txt': 'hello' })
    const result = await collectFiles(root, false, 0, () => undefined)
    expect(result.scannedFiles).toBe(1)
    expect(result.entries.map((entry) => entry.path)).toEqual([join(root, 'a.txt')])
  })

  it('文件数超过上限 → DF_TOO_MANY_FILES', async () => {
    const root = await setup({ 'a.txt': 'a', 'b.txt': 'b' })
    await expect(collectFiles(root, true, 0, () => undefined, 1)).rejects.toMatchObject({
      code: 'DF_TOO_MANY_FILES'
    })
  })

  it('根目录不存在 → DF_ROOT_INVALID', async () => {
    await expect(
      collectFiles(join(tmpdir(), 'lumin-df-not-exist-2026'), true, 0, () => undefined)
    ).rejects.toMatchObject({ code: 'DF_ROOT_INVALID' })
  })

  it('每 200 个文件推送一次扫描进度', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 200; index += 1) files[`f${index}.txt`] = `${index}`
    const root = await setup(files)
    const counts: number[] = []
    await collectFiles(root, true, 0, (scanned) => counts.push(scanned))
    expect(counts).toEqual([200])
  })
})

describe('runScan', () => {
  it('递归发现跨子目录重复，按可释放空间排序并给出完整哈希', async () => {
    const root = await setup({
      'a.txt': 'hello',
      'sub/b.txt': 'hello',
      'sub/deep/c.txt': 'hello',
      'other.txt': 'world'
    })
    const { ctx, updates } = createCtx()
    const request: ScanRequest = { root, recursive: true, minBytes: 1 }
    const result = await runScan(request, ctx, () => 1234)

    expect(result.groups).toHaveLength(1)
    const group = result.groups[0]
    expect(group?.size).toBe(5)
    expect(group?.files.map((file) => file.path).sort()).toEqual(
      [join(root, 'a.txt'), join(root, 'sub', 'b.txt'), join(root, 'sub', 'deep', 'c.txt')].sort()
    )
    expect(group?.hash).toBe(sha256('hello'))
    expect(group?.wastedBytes).toBe(10)
    expect(result.scannedFiles).toBe(4)
    expect(result.totalWastedBytes).toBe(10)
    expect(result.elapsedMs).toBe(0)

    const stages = new Set(updates.map((update) => (update.kind === 'progress' ? update.stage : '')))
    expect([...stages].sort()).toEqual(['full', 'partial', 'scan'])
  })

  it('非递归不把子目录文件并入重复组', async () => {
    const root = await setup({ 'a.txt': 'hello', 'b.txt': 'hello', 'sub/c.txt': 'hello' })
    const { ctx } = createCtx()
    const result = await runScan({ root, recursive: false, minBytes: 1 }, ctx)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.files).toHaveLength(2)
  })

  it('小于阈值的文件不参与去重但仍计入 scannedFiles', async () => {
    const root = await setup({ 'a.txt': 'x', 'b.txt': 'x' })
    const { ctx } = createCtx()
    const result = await runScan({ root, recursive: true, minBytes: 10 }, ctx)
    expect(result.groups).toEqual([])
    expect(result.scannedFiles).toBe(2)
    expect(result.totalWastedBytes).toBe(0)
  })

  it('大于 64KB 的同前缀文件经全量哈希分化', async () => {
    const prefix = 'a'.repeat(PARTIAL_BYTES)
    const same = `${prefix}${'tail'}`
    const different = `${prefix}${'TAIL'}`
    const root = await setup({ 'a.bin': same, 'b.bin': same, 'c.bin': different })
    const { ctx } = createCtx()
    const result = await runScan({ root, recursive: true, minBytes: 1 }, ctx)

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.files.map((file) => file.path).sort()).toEqual(
      [join(root, 'a.bin'), join(root, 'b.bin')].sort()
    )
    expect(result.groups[0]?.hash).toBe(sha256(same))
  })

  it('空文件可成组（minBytes=0），可释放空间为 0', async () => {
    const root = await setup({ 'a.txt': '', 'b.txt': '' })
    const { ctx } = createCtx()
    const result = await runScan({ root, recursive: true, minBytes: 0 }, ctx)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.size).toBe(0)
    expect(result.groups[0]?.wastedBytes).toBe(0)
    expect(result.groups[0]?.hash).toBe(sha256(''))
  })

  it('空目录返回空结果', async () => {
    const root = await setup({})
    const { ctx, updates } = createCtx()
    const result = await runScan({ root, recursive: true, minBytes: 0 }, ctx)
    expect(result.groups).toEqual([])
    expect(result.scannedFiles).toBe(0)
    expect(updates.length).toBeGreaterThanOrEqual(2)
  })
})

describe('hashFileRange', () => {
  it('0 字节返回空内容摘要', async () => {
    await expect(hashFileRange('不存在的路径', 0)).resolves.toBe(sha256(''))
  })

  it('只读取指定前缀范围', async () => {
    const root = await setup({ 'a.txt': 'abcdef' })
    await expect(hashFileRange(join(root, 'a.txt'), 3)).resolves.toBe(sha256('abc'))
  })
})
