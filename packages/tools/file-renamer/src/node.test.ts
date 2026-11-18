/**
 * @file node.ts 单测（真实临时目录 + 可注入 fs 依赖）
 * @author cuilanchao
 * @date 2026-11-18
 * @description scan/apply/undo/config/set-dir 通道行为：排序截断、目录缺失、
 *              冲突不中断、大小写改名、失败归类、取消、撤销与目录记忆
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readdir, rename, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  IpcHandler,
  MainPluginContext,
  TaskHandler,
  TaskHandlerContext
} from '@lumin/plugin-api'
import type { StructuredError, TaskUpdate } from '@lumin/shared'
import { manifest } from './manifest'
import { registerWith, type FileRenamerDeps } from './node'
import { SCAN_LIMIT } from './schema'

interface Harness {
  ipc: Map<string, IpcHandler<unknown, unknown>>
  tasks: Map<string, TaskHandler<unknown, unknown>>
  settings: Map<string, unknown>
  dir: string
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * 构造测试上下文（真实 fs 依赖，可局部覆盖以模拟异常）
 * @param overrides 覆盖 readdir/stat/rename
 */
function createHarness(overrides: Partial<FileRenamerDeps> = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'lumin-fr-test-'))
  roots.push(dir)
  const deps: FileRenamerDeps = {
    readdir: readdir as unknown as FileRenamerDeps['readdir'],
    stat: stat as unknown as FileRenamerDeps['stat'],
    rename: rename as unknown as FileRenamerDeps['rename'],
    ...overrides
  }
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const ctx: MainPluginContext = {
    toolId: manifest.id,
    manifest,
    registerIpc: (action, handler) => {
      ipc.set(action, handler as unknown as IpcHandler<unknown, unknown>)
    },
    registerTask: (action, handler) => {
      tasks.set(action, handler as unknown as TaskHandler<unknown, unknown>)
    },
    settings: {
      get: async (key, defaultValue) =>
        settings.has(key) ? (settings.get(key) as never) : defaultValue,
      set: async (key, value) => {
        settings.set(key, value)
      }
    },
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    paths: {
      temp: join(dir, 'temp'),
      userData: join(dir, 'userData'),
      binaries: join(dir, 'binaries')
    }
  }
  registerWith(ctx, deps)
  return { ipc, tasks, settings, dir }
}

async function invokeIpc(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  const handler = harness.ipc.get(action)
  if (handler === undefined) throw new Error(`缺少 IPC handler：${action}`)
  return handler({ toolId: manifest.id, action, payload })
}

async function runTask(
  harness: Harness,
  action: 'apply' | 'undo',
  payload: unknown,
  opts: { signal?: AbortSignal } = {}
): Promise<{ result: unknown; updates: TaskUpdate[]; error?: StructuredError }> {
  const handler = harness.tasks.get(action)
  if (handler === undefined) throw new Error(`缺少 task handler：${action}`)
  const updates: TaskUpdate[] = []
  const taskCtx: TaskHandlerContext<unknown> = {
    toolId: manifest.id,
    action,
    payload,
    taskId: 'task-1',
    signal: opts.signal ?? new AbortController().signal,
    emit: (update) => updates.push(update)
  }
  try {
    const result = await handler(taskCtx)
    return { result, updates }
  } catch (err) {
    return { result: undefined, updates, error: err as StructuredError }
  }
}

/** 在目录内造文件（内容任意） */
function touch(dir: string, name: string): void {
  writeFileSync(join(dir, name), 'x')
}

/** 读取目录文件名（排序后断言用） */
function namesOf(dir: string): string[] {
  return readdirSync(dir)
}

describe('scan', () => {
  it('仅列普通文件、按名称排序并带 size/mtime', async () => {
    const harness = createHarness()
    touch(harness.dir, 'b.txt')
    touch(harness.dir, 'a 中文.txt')
    mkdirSync(join(harness.dir, 'sub'))
    const result = (await invokeIpc(harness, 'scan', { dir: harness.dir })) as {
      files: { name: string; size: number; mtimeMs: number }[]
      truncated: boolean
    }
    expect(result.truncated).toBe(false)
    expect(result.files.map((file) => file.name)).toEqual(['a 中文.txt', 'b.txt'])
    expect(result.files.every((file) => file.size === 1 && file.mtimeMs > 0)).toBe(true)
  })

  it('目录不存在 → FR_DIR_NOT_FOUND', async () => {
    const harness = createHarness()
    await expect(
      invokeIpc(harness, 'scan', { dir: join(harness.dir, 'missing') })
    ).rejects.toMatchObject({ code: 'FR_DIR_NOT_FOUND' })
  })

  it('超过上限截断并标记 truncated', async () => {
    const total = SCAN_LIMIT + 5
    const names = Array.from({ length: total }, (_item, index) => `f${index}.txt`)
    const harness = createHarness({
      readdir: (async (_path: string, options?: unknown) =>
        options === undefined
          ? names
          : names.map((name) => ({
              name,
              isFile: () => true
            }))) as unknown as FileRenamerDeps['readdir'],
      stat: (async () => ({ size: 1, mtimeMs: 1 })) as unknown as FileRenamerDeps['stat']
    })
    const result = (await invokeIpc(harness, 'scan', { dir: harness.dir })) as {
      files: unknown[]
      truncated: boolean
    }
    expect(result.truncated).toBe(true)
    expect(result.files).toHaveLength(SCAN_LIMIT)
  })

  it('参数非法 → INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expect(invokeIpc(harness, 'scan', { dir: '' })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })
})

describe('apply / undo', () => {
  it('批量改名成功并落盘', async () => {
    const harness = createHarness()
    touch(harness.dir, 'a.txt')
    touch(harness.dir, 'b.txt')
    const { result, updates } = await runTask(harness, 'apply', {
      dir: harness.dir,
      pairs: [
        { from: 'a.txt', to: '001-a.txt' },
        { from: 'b.txt', to: '002-b.txt' }
      ]
    })
    expect(result).toMatchObject({
      renamed: [
        { from: 'a.txt', to: '001-a.txt' },
        { from: 'b.txt', to: '002-b.txt' }
      ],
      failures: []
    })
    expect(namesOf(harness.dir).sort()).toEqual(['001-a.txt', '002-b.txt'])
    expect(updates.filter((update) => update.kind === 'progress')).toHaveLength(3)
  })

  it('目标已存在 → 该条 FR_CONFLICT，其余继续', async () => {
    const harness = createHarness()
    touch(harness.dir, 'a.txt')
    touch(harness.dir, 'b.txt')
    touch(harness.dir, 'taken.txt')
    const { result } = await runTask(harness, 'apply', {
      dir: harness.dir,
      pairs: [
        { from: 'a.txt', to: 'taken.txt' },
        { from: 'b.txt', to: 'new-b.txt' }
      ]
    })
    expect(result).toMatchObject({
      renamed: [{ from: 'b.txt', to: 'new-b.txt' }],
      failures: [{ from: 'a.txt', code: 'FR_CONFLICT' }]
    })
    expect(namesOf(harness.dir).sort()).toEqual(['a.txt', 'new-b.txt', 'taken.txt'])
  })

  it('批内重复目标 → 第二条冲突', async () => {
    const harness = createHarness()
    touch(harness.dir, 'a.txt')
    touch(harness.dir, 'b.txt')
    const { result } = await runTask(harness, 'apply', {
      dir: harness.dir,
      pairs: [
        { from: 'a.txt', to: 'same.txt' },
        { from: 'b.txt', to: 'same.txt' }
      ]
    })
    expect(result).toMatchObject({
      renamed: [{ from: 'a.txt', to: 'same.txt' }],
      failures: [{ from: 'b.txt', code: 'FR_CONFLICT' }]
    })
  })

  it('仅大小写改名允许（Windows 不敏感）', async () => {
    const harness = createHarness()
    touch(harness.dir, 'a.txt')
    const { result } = await runTask(harness, 'apply', {
      dir: harness.dir,
      pairs: [{ from: 'a.txt', to: 'A.txt' }]
    })
    expect(result).toMatchObject({ renamed: [{ from: 'a.txt', to: 'A.txt' }], failures: [] })
    expect(namesOf(harness.dir)).toEqual(['A.txt'])
  })

  it('来源不存在 → FR_RENAME_FAILED（不中断批次）', async () => {
    const harness = createHarness()
    touch(harness.dir, 'a.txt')
    const { result } = await runTask(harness, 'apply', {
      dir: harness.dir,
      pairs: [
        { from: 'ghost.txt', to: 'x.txt' },
        { from: 'a.txt', to: 'z.txt' }
      ]
    })
    expect(result).toMatchObject({
      renamed: [{ from: 'a.txt', to: 'z.txt' }],
      failures: [{ from: 'ghost.txt', code: 'FR_RENAME_FAILED' }]
    })
  })

  it('取消后不再执行剩余条目', async () => {
    const harness = createHarness()
    touch(harness.dir, 'a.txt')
    touch(harness.dir, 'b.txt')
    const controller = new AbortController()
    controller.abort()
    const { result } = await runTask(
      harness,
      'apply',
      {
        dir: harness.dir,
        pairs: [
          { from: 'a.txt', to: 'x.txt' },
          { from: 'b.txt', to: 'y.txt' }
        ]
      },
      { signal: controller.signal }
    )
    expect(result).toMatchObject({ renamed: [], failures: [] })
    expect(namesOf(harness.dir).sort()).toEqual(['a.txt', 'b.txt'])
  })

  it('undo 恢复原名', async () => {
    const harness = createHarness()
    touch(harness.dir, 'a.txt')
    await runTask(harness, 'apply', { dir: harness.dir, pairs: [{ from: 'a.txt', to: 'b.txt' }] })
    const { result } = await runTask(harness, 'undo', {
      dir: harness.dir,
      pairs: [{ from: 'b.txt', to: 'a.txt' }]
    })
    expect(result).toMatchObject({ renamed: [{ from: 'b.txt', to: 'a.txt' }], failures: [] })
    expect(namesOf(harness.dir)).toEqual(['a.txt'])
  })

  it('目录不存在 → FR_DIR_NOT_FOUND', async () => {
    const harness = createHarness()
    const { error } = await runTask(harness, 'apply', {
      dir: join(harness.dir, 'missing'),
      pairs: [{ from: 'a.txt', to: 'b.txt' }]
    })
    expect(error).toMatchObject({ code: 'FR_DIR_NOT_FOUND' })
  })

  it('pairs 为空 → INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    const { error } = await runTask(harness, 'apply', { dir: harness.dir, pairs: [] })
    expect(error).toMatchObject({ code: 'INVALID_PAYLOAD' })
  })
})

describe('config / set-dir', () => {
  it('缺省 lastDir 为 null，set 后可读', async () => {
    const harness = createHarness()
    expect(await invokeIpc(harness, 'config', {})).toEqual({ lastDir: null })
    await invokeIpc(harness, 'set-dir', { dir: harness.dir })
    expect(await invokeIpc(harness, 'config', {})).toEqual({ lastDir: harness.dir })
  })

  it('set-dir 空串 → INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expect(invokeIpc(harness, 'set-dir', { dir: '' })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })
})
