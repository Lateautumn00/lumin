/**
 * @file compare.worker.test.ts 双目录配对真实临时目录单测
 * @author cuilanchao
 * @date 2026-11-20
 * @description 覆盖配对分类/时间容差/开关/大小写不敏感/上限/截断/根目录非法/进度（spec §5.3）
 */
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TaskRunContext } from '@lumin/node-kit'
import type { TaskUpdate } from '@lumin/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { runCompare } from './compare.worker'
import type { CompareRequest } from './schema'

/** 固定基准时间（毫秒） */
const BASE = Date.UTC(2026, 0, 1)

/** 临时目录列表（afterEach 清理） */
const tempDirs: string[] = []

/** 建临时目录并写入文件（键为相对路径） */
async function setup(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lumin-fc-'))
  tempDirs.push(root)
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, content)
  }
  return root
}

/** 设置文件修改时间 */
async function touch(root: string, rel: string, mtimeMs: number): Promise<void> {
  const seconds = mtimeMs / 1000
  await utimes(join(root, rel), seconds, seconds)
}

/** 收集进度的假任务上下文 */
function createCtx(): { ctx: TaskRunContext; updates: TaskUpdate[] } {
  const updates: TaskUpdate[] = []
  return { ctx: { emit: (update) => updates.push(update) }, updates }
}

function request(leftRoot: string, rightRoot: string, compareMtime = true): CompareRequest {
  return { leftRoot, rightRoot, compareMtime }
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop() as string
    await rm(dir, { recursive: true, force: true })
  }
})

describe('runCompare 配对口径', () => {
  it('四类分类正确 + 计数与文件数', async () => {
    const left = await setup({
      'same.txt': 'abcd',
      'size.txt': 'abcd',
      'mtime.txt': 'abcd',
      'only-left.txt': 'x',
      'nested/deep/x.txt': '11'
    })
    const right = await setup({
      'same.txt': 'wxyz',
      'size.txt': 'abcdef',
      'mtime.txt': 'abcd',
      'only-right.txt': 'y',
      'nested/deep/x.txt': '22'
    })
    for (const rel of ['same.txt', 'size.txt', 'only-left.txt', 'nested/deep/x.txt']) {
      await touch(left, rel, BASE)
    }
    for (const rel of ['same.txt', 'size.txt', 'only-right.txt', 'nested/deep/x.txt']) {
      await touch(right, rel, BASE)
    }
    await touch(left, 'mtime.txt', BASE)
    await touch(right, 'mtime.txt', BASE + 5000)

    const { ctx } = createCtx()
    const result = await runCompare(request(left, right), ctx, () => 1000)

    expect(result).toMatchObject({
      onlyLeft: 1,
      onlyRight: 1,
      different: 2,
      same: 2,
      leftFiles: 5,
      rightFiles: 5,
      skipped: 0,
      truncated: 0,
      elapsedMs: 0
    })
    const byPath = new Map(result.entries.map((entry) => [entry.path, entry]))
    expect(byPath.get('only-left.txt')).toMatchObject({
      status: 'only-left',
      sizeLeft: 1,
      sizeRight: null,
      mtimeRight: null
    })
    expect(byPath.get('only-right.txt')).toMatchObject({
      status: 'only-right',
      sizeLeft: null,
      sizeRight: 1
    })
    expect(byPath.get('size.txt')).toMatchObject({
      status: 'different',
      sizeChanged: true,
      mtimeChanged: false
    })
    expect(byPath.get('mtime.txt')).toMatchObject({
      status: 'different',
      sizeChanged: false,
      mtimeChanged: true
    })
    expect(byPath.get('same.txt')).toMatchObject({ status: 'same' })
    expect(byPath.get('nested/deep/x.txt')).toMatchObject({ status: 'same', sizeLeft: 2 })
    // 排序：仅左侧 → 仅右侧 → 有差异 → 相同
    expect(result.entries[0]?.path).toBe('only-left.txt')
  })

  it('关闭修改时间比较后时间差不算差异', async () => {
    const left = await setup({ 't.txt': 'abcd' })
    const right = await setup({ 't.txt': 'abcd' })
    await touch(left, 't.txt', BASE)
    await touch(right, 't.txt', BASE + 9000)
    const { ctx } = createCtx()
    const result = await runCompare(request(left, right, false), ctx, () => 0)
    expect(result).toMatchObject({ different: 0, same: 1, compareMtime: false })
  })

  it('大小写不敏感配对且展示左侧原样路径', async () => {
    const left = await setup({ 'Case.TXT': 'abc' })
    const right = await setup({ 'case.txt': 'abcd' })
    await touch(left, 'Case.TXT', BASE)
    await touch(right, 'case.txt', BASE)
    const { ctx } = createCtx()
    const result = await runCompare(request(left, right), ctx, () => 0)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({ path: 'Case.TXT', status: 'different' })
  })

  it('中文与空格路径正常配对', async () => {
    const left = await setup({ '作业 资料/试卷 一.txt': 'abcd' })
    const right = await setup({ '作业 资料/试卷 一.txt': 'abcd' })
    await touch(left, '作业 资料/试卷 一.txt', BASE)
    await touch(right, '作业 资料/试卷 一.txt', BASE)
    const { ctx } = createCtx()
    const result = await runCompare(request(left, right), ctx, () => 0)
    expect(result.entries).toEqual([
      expect.objectContaining({ path: '作业 资料/试卷 一.txt', status: 'same' })
    ])
    expect(result.leftFiles).toBe(1)
  })

  it('两侧空目录返回空结果与 0 汇总', async () => {
    const left = await setup({})
    const right = await setup({})
    const { ctx } = createCtx()
    await expect(runCompare(request(left, right), ctx, () => 0)).resolves.toMatchObject({
      entries: [],
      onlyLeft: 0,
      onlyRight: 0,
      different: 0,
      same: 0,
      leftFiles: 0,
      rightFiles: 0
    })
  })
})

describe('runCompare 上限与错误', () => {
  it('单侧文件数超上限 → FC_TOO_MANY_FILES（detail 标侧别）', async () => {
    const left = await setup({ 'a.txt': 'a', 'b.txt': 'b' })
    const right = await setup({})
    const { ctx } = createCtx()
    await expect(runCompare(request(left, right), ctx, () => 0, 1)).rejects.toMatchObject({
      code: 'FC_TOO_MANY_FILES',
      detail: expect.stringContaining('左侧')
    })
  })

  it('结果条目超上限 → 截断并计 truncated（四类计数仍全量）', async () => {
    const left = await setup({ 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c' })
    const right = await setup({})
    const { ctx } = createCtx()
    const result = await runCompare(request(left, right), ctx, () => 0, 200_000, 2)
    expect(result.entries).toHaveLength(2)
    expect(result).toMatchObject({ onlyLeft: 3, truncated: 1 })
  })

  it('左侧根目录不存在 → FC_ROOT_INVALID；右侧同理', async () => {
    const right = await setup({})
    const { ctx } = createCtx()
    await expect(
      runCompare(request(join(tmpdir(), 'lumin-fc-missing-left-2026'), right), ctx)
    ).rejects.toMatchObject({
      code: 'FC_ROOT_INVALID',
      detail: expect.stringContaining('左侧')
    })
    const left = await setup({})
    await expect(
      runCompare(request(left, join(tmpdir(), 'lumin-fc-missing-right-2026')), ctx)
    ).rejects.toMatchObject({
      code: 'FC_ROOT_INVALID',
      detail: expect.stringContaining('右侧')
    })
  })

  it('进度：两侧起始进度均推送且 stage 正确', async () => {
    const left = await setup({ 'a.txt': 'a' })
    const right = await setup({ 'a.txt': 'a' })
    const { ctx, updates } = createCtx()
    await runCompare(request(left, right), ctx, () => 0)
    const progress = updates.filter((update) => update.kind === 'progress')
    expect(progress[0]).toMatchObject({ kind: 'progress', current: 0, stage: 'left' })
    expect(progress.some((update) => update.kind === 'progress' && update.stage === 'right')).toBe(
      true
    )
  })
})
