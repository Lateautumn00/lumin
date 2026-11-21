/**
 * @file node.test.ts 主进程四通道单测（内存 fs 假件）
 * @author cuilanchao
 * @date 2026-11-21
 * @description config 归一 / tree 深度与排除 / empty-dirs 判定 / touch 预演与应用 / temp-clean 匹配 / 取消
 */
import { join } from 'node:path'
import type { IpcHandler, MainPluginContext, TaskHandler } from '@lumin/plugin-api'
import type { TaskUpdate } from '@lumin/shared'
import { describe, expect, it, vi } from 'vitest'
import { manifest } from './manifest'
import {
  createDefaultDeps,
  registerWith,
  type DirentLike,
  type FsCleanerDeps,
  type StatLike
} from './node'
import {
  DEFAULT_TEMP_EXTENSIONS,
  DEFAULT_TREE_DEPTH,
  MAX_SCAN_FILES,
  type EmptyDirsResult,
  type TempCleanResult,
  type TouchResult,
  type TreeResult
} from './schema'

interface Harness {
  ctx: MainPluginContext
  sync: Map<string, IpcHandler<unknown, unknown>>
  tasks: Map<string, TaskHandler<unknown, unknown>>
  settings: Map<string, unknown>
  events: TaskUpdate[]
}

/** 构造可检视的插件上下文 */
function createContext(): Harness {
  const sync = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const events: TaskUpdate[] = []
  const ctx: MainPluginContext = {
    toolId: manifest.id,
    manifest,
    registerIpc: <P, R>(action: string, handler: IpcHandler<P, R>): void => {
      sync.set(action, handler as unknown as IpcHandler<unknown, unknown>)
    },
    registerTask: <P, R>(action: string, handler: TaskHandler<P, R>): void => {
      tasks.set(action, handler as unknown as TaskHandler<unknown, unknown>)
    },
    settings: {
      get: async <T>(key: string, defaultValue: T): Promise<T> => {
        const value = settings.get(key)
        return value === undefined ? defaultValue : (value as T)
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        settings.set(key, value)
      }
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    paths: { temp: 'C:\\temp', userData: 'C:\\userData', binaries: 'C:\\binaries' }
  }
  return { ctx, sync, tasks, settings, events }
}

/** 内存 fs：路径 → 目录/文件（文件带 size） */
const ROOT = 'C:\\fake\\root'

interface FakeFs {
  store: Map<string, { kind: 'dir' | 'file'; size: number }>
  utimesCalls: { path: string; mtime: Date }[]
  locked: Set<string>
}

function createFs(): FakeFs {
  return { store: new Map(), utimesCalls: [], locked: new Set() }
}

function addDir(fs: FakeFs, path: string): void {
  fs.store.set(path, { kind: 'dir', size: 0 })
}

function addFile(fs: FakeFs, path: string, size = 4): void {
  fs.store.set(path, { kind: 'file', size })
}

function childPaths(fs: FakeFs, dir: string): string[] {
  const prefix = `${dir}\\`
  return [...fs.store.keys()].filter((path) => {
    if (!path.startsWith(prefix)) return false
    return !path.slice(prefix.length).includes('\\')
  })
}

function enoent(): Error {
  return Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
}

function createDeps(fs: FakeFs): FsCleanerDeps {
  return {
    readdir: async (path): Promise<DirentLike[]> => {
      if (!fs.store.has(path)) throw enoent()
      return childPaths(fs, path).map((child) => {
        const name = child.slice(child.lastIndexOf('\\') + 1)
        const entry = fs.store.get(child) ?? { kind: 'dir', size: 0 }
        return {
          name,
          isDirectory: () => entry.kind === 'dir',
          isFile: () => entry.kind === 'file'
        }
      })
    },
    stat: async (path): Promise<StatLike> => {
      const entry = fs.store.get(path)
      if (entry === undefined) throw enoent()
      return { size: entry.size, mtimeMs: 0, isFile: () => entry.kind === 'file' }
    },
    utimes: async (path, _atime, mtime): Promise<void> => {
      if (fs.locked.has(path)) {
        throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      }
      fs.utimesCalls.push({ path, mtime })
    }
  }
}

async function callSync(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  const handler = harness.sync.get(action)
  if (handler === undefined) throw new Error(`未注册同步通道：${action}`)
  return handler({ toolId: manifest.id, action, payload })
}

async function callTask<R>(
  harness: Harness,
  action: string,
  payload: unknown,
  signal?: AbortSignal
): Promise<R> {
  const handler = harness.tasks.get(action)
  if (handler === undefined) throw new Error(`未注册任务通道：${action}`)
  return (await handler({
    toolId: manifest.id,
    action,
    payload,
    taskId: 'task-1',
    signal: signal ?? new AbortController().signal,
    emit: (update) => harness.events.push(update)
  })) as R
}

/** 根 + a.txt + sub/b.md + node_modules/x.js */
function seedTree(fs: FakeFs): void {
  addDir(fs, ROOT)
  addFile(fs, join(ROOT, 'a.txt'))
  addDir(fs, join(ROOT, 'sub'))
  addFile(fs, join(ROOT, 'sub', 'b.md'))
  addDir(fs, join(ROOT, 'node_modules'))
  addFile(fs, join(ROOT, 'node_modules', 'x.js'))
}

describe('config / set-config', () => {
  it('无存量时返回默认值', async () => {
    const harness = createContext()
    registerWith(harness.ctx, createDeps(createFs()))
    expect(await callSync(harness, 'config', {})).toEqual({
      lastRoot: null,
      treeDepth: DEFAULT_TREE_DEPTH,
      treeExclude: [],
      tempExtensions: DEFAULT_TEMP_EXTENSIONS
    })
  })

  it('非法存量归一为默认值', async () => {
    const harness = createContext()
    registerWith(harness.ctx, createDeps(createFs()))
    harness.settings.set('lastRoot', '')
    harness.settings.set('treeDepth', 99)
    harness.settings.set('treeExclude', ['ok', 1])
    harness.settings.set('tempExtensions', 'not-an-array')
    const result = (await callSync(harness, 'config', {})) as {
      lastRoot: string | null
      treeDepth: number
      treeExclude: string[]
      tempExtensions: string[]
    }
    expect(result.lastRoot).toBeNull()
    expect(result.treeDepth).toBe(DEFAULT_TREE_DEPTH)
    expect(result.treeExclude).toEqual(['ok'])
    expect(result.tempExtensions).toEqual(DEFAULT_TEMP_EXTENSIONS)
  })

  it('合法存量原样返回', async () => {
    const harness = createContext()
    registerWith(harness.ctx, createDeps(createFs()))
    harness.settings.set('lastRoot', ROOT)
    harness.settings.set('treeDepth', 5)
    harness.settings.set('treeExclude', ['dist'])
    harness.settings.set('tempExtensions', ['log'])
    expect(await callSync(harness, 'config', {})).toEqual({
      lastRoot: ROOT,
      treeDepth: 5,
      treeExclude: ['dist'],
      tempExtensions: ['log']
    })
  })

  it('set-config 持久化并回读', async () => {
    const harness = createContext()
    registerWith(harness.ctx, createDeps(createFs()))
    const result = await callSync(harness, 'set-config', {
      lastRoot: ROOT,
      treeDepth: 4,
      treeExclude: ['dist'],
      tempExtensions: ['log', 'tmp']
    })
    expect(result).toEqual({
      lastRoot: ROOT,
      treeDepth: 4,
      treeExclude: ['dist'],
      tempExtensions: ['log', 'tmp']
    })
    expect(harness.settings.get('treeDepth')).toBe(4)
  })

  it('set-config 非法入参报 INVALID_PAYLOAD', async () => {
    const harness = createContext()
    registerWith(harness.ctx, createDeps(createFs()))
    await expect(callSync(harness, 'set-config', { treeDepth: 99 })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })
})

describe('tree', () => {
  it('生成树文本并统计，排除规则生效', async () => {
    const fs = createFs()
    seedTree(fs)
    const harness = createContext()
    registerWith(harness.ctx, createDeps(fs))
    const result = await callTask<TreeResult>(harness, 'tree', {
      root: ROOT,
      maxDepth: 3,
      exclude: ['node_modules']
    })
    expect(result.text).not.toContain('node_modules')
    expect(result.text).toContain('a.txt')
    expect(result.text).toContain('b.md')
    expect(result.dirs).toBe(1)
    expect(result.files).toBe(2)
    expect(result.truncated).toBe(false)
    // tree 任务记忆目录与选项
    expect(harness.settings.get('lastRoot')).toBe(ROOT)
    expect(harness.settings.get('treeDepth')).toBe(3)
  })

  it('深度限制触发截断标记', async () => {
    const fs = createFs()
    seedTree(fs)
    const harness = createContext()
    registerWith(harness.ctx, createDeps(fs))
    const result = await callTask<TreeResult>(harness, 'tree', {
      root: ROOT,
      maxDepth: 1,
      exclude: []
    })
    expect(result.truncated).toBe(true)
    expect(result.text).not.toContain('b.md')
  })

  it('根目录不可读报 FC_ROOT_INVALID', async () => {
    const harness = createContext()
    registerWith(harness.ctx, createDeps(createFs()))
    await expect(
      callTask(harness, 'tree', { root: 'C:\\missing', maxDepth: 2, exclude: [] })
    ).rejects.toMatchObject({ code: 'FC_ROOT_INVALID' })
  })

  it('条目超上限报 FC_TOO_MANY_FILES', async () => {
    const harness = createContext()
    const dirents: DirentLike[] = Array.from({ length: MAX_SCAN_FILES + 1 }, (_, index) => ({
      name: `f${index}.txt`,
      isDirectory: () => false,
      isFile: () => true
    }))
    const deps: FsCleanerDeps = {
      readdir: async () => dirents,
      stat: async () => ({ size: 1, mtimeMs: 0, isFile: () => true }),
      utimes: async () => undefined
    }
    registerWith(harness.ctx, deps)
    await expect(
      callTask(harness, 'tree', { root: ROOT, maxDepth: 2, exclude: [] })
    ).rejects.toMatchObject({ code: 'FC_TOO_MANY_FILES' })
  })

  it('推送进度事件', async () => {
    const fs = createFs()
    seedTree(fs)
    const harness = createContext()
    registerWith(harness.ctx, createDeps(fs))
    await callTask(harness, 'tree', { root: ROOT, maxDepth: 2, exclude: [] })
    expect(harness.events.some((event) => event.kind === 'progress')).toBe(true)
  })
})

describe('empty-dirs', () => {
  it('自底向上列出全空链路（深层在前）', async () => {
    const fs = createFs()
    addDir(fs, ROOT)
    addFile(fs, join(ROOT, 'keep.txt'))
    addDir(fs, join(ROOT, 'a'))
    addDir(fs, join(ROOT, 'a', 'b'))
    addDir(fs, join(ROOT, 'a', 'b', 'c'))
    const harness = createContext()
    registerWith(harness.ctx, createDeps(fs))
    const result = await callTask<EmptyDirsResult>(harness, 'empty-dirs', { root: ROOT })
    expect(result.dirs).toEqual([
      join(ROOT, 'a', 'b', 'c'),
      join(ROOT, 'a', 'b'),
      join(ROOT, 'a')
    ])
    expect(result.scannedDirs).toBe(4)
  })

  it('根目录不可读报 FC_ROOT_INVALID', async () => {
    const harness = createContext()
    registerWith(harness.ctx, createDeps(createFs()))
    await expect(callTask(harness, 'empty-dirs', { root: 'C:\\missing' })).rejects.toMatchObject({
      code: 'FC_ROOT_INVALID'
    })
  })

  it('已取消时立即收敛为空结果', async () => {
    const fs = createFs()
    addDir(fs, ROOT)
    addDir(fs, join(ROOT, 'a'))
    const harness = createContext()
    registerWith(harness.ctx, createDeps(fs))
    const controller = new AbortController()
    controller.abort()
    const result = await callTask<EmptyDirsResult>(
      harness,
      'empty-dirs',
      { root: ROOT },
      controller.signal
    )
    expect(result.dirs).toEqual([])
    expect(result.scannedDirs).toBe(0)
  })
})

describe('touch', () => {
  it('预演只统计不写盘', async () => {
    const fs = createFs()
    seedTree(fs)
    const harness = createContext()
    registerWith(harness.ctx, createDeps(fs))
    const result = await callTask<TouchResult>(harness, 'touch', {
      root: ROOT,
      recursive: true,
      extensions: ['txt'],
      mtimeMs: 1_700_000_000_000,
      dryRun: true
    })
    expect(result.total).toBe(1)
    expect(result.updated).toBe(0)
    expect(result.sample).toEqual([join(ROOT, 'a.txt')])
    expect(fs.utimesCalls).toHaveLength(0)
  })

  it('应用逐条写盘，失败项计入 failures', async () => {
    const fs = createFs()
    seedTree(fs)
    fs.locked.add(join(ROOT, 'sub', 'b.md'))
    const harness = createContext()
    registerWith(harness.ctx, createDeps(fs))
    const mtimeMs = 1_700_000_000_000
    const result = await callTask<TouchResult>(harness, 'touch', {
      root: ROOT,
      recursive: true,
      extensions: [],
      mtimeMs,
      dryRun: false
    })
    expect(result.total).toBe(3)
    expect(result.updated).toBe(2)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.code).toBe('FC_TOUCH_FAILED')
    expect(fs.utimesCalls.every((call) => call.mtime.getTime() === mtimeMs)).toBe(true)
  })

  it('非递归时子目录文件不参与', async () => {
    const fs = createFs()
    seedTree(fs)
    const harness = createContext()
    registerWith(harness.ctx, createDeps(fs))
    const result = await callTask<TouchResult>(harness, 'touch', {
      root: ROOT,
      recursive: false,
      extensions: [],
      mtimeMs: 1_700_000_000_000,
      dryRun: true
    })
    expect(result.total).toBe(1)
  })

  it('根目录不可读报 FC_ROOT_INVALID', async () => {
    const harness = createContext()
    registerWith(harness.ctx, createDeps(createFs()))
    await expect(
      callTask(harness, 'touch', {
        root: 'C:\\missing',
        recursive: true,
        extensions: [],
        mtimeMs: 0,
        dryRun: true
      })
    ).rejects.toMatchObject({ code: 'FC_ROOT_INVALID' })
  })
})

describe('temp-clean', () => {
  it('按扩展名匹配并汇总字节', async () => {
    const fs = createFs()
    seedTree(fs)
    addFile(fs, join(ROOT, 'debug.log'), 10)
    addFile(fs, join(ROOT, 'sub', 'cache.tmp'), 20)
    const harness = createContext()
    registerWith(harness.ctx, createDeps(fs))
    const result = await callTask<TempCleanResult>(harness, 'temp-clean', {
      root: ROOT,
      recursive: true,
      extensions: ['log', 'tmp']
    })
    expect(result.files.map((file) => file.path).sort()).toEqual(
      [join(ROOT, 'debug.log'), join(ROOT, 'sub', 'cache.tmp')].sort()
    )
    expect(result.matchedBytes).toBe(30)
    expect(result.scannedFiles).toBe(5)
  })

  it('非递归忽略子目录', async () => {
    const fs = createFs()
    seedTree(fs)
    addFile(fs, join(ROOT, 'sub', 'cache.tmp'), 20)
    const harness = createContext()
    registerWith(harness.ctx, createDeps(fs))
    const result = await callTask<TempCleanResult>(harness, 'temp-clean', {
      root: ROOT,
      recursive: false,
      extensions: ['tmp']
    })
    expect(result.files).toEqual([])
  })

  it('缺扩展名规则报 INVALID_PAYLOAD', async () => {
    const harness = createContext()
    registerWith(harness.ctx, createDeps(createFs()))
    await expect(
      callTask(harness, 'temp-clean', { root: ROOT, recursive: true, extensions: [] })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
  })
})

describe('createDefaultDeps', () => {
  it('返回三个真实 fs 函数', () => {
    const deps = createDefaultDeps()
    expect(typeof deps.readdir).toBe('function')
    expect(typeof deps.stat).toBe('function')
    expect(typeof deps.utimes).toBe('function')
  })
})
