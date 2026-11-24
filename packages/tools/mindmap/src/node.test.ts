/**
 * @file 主进程 8 通道单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 注入内存文件系统与对话框依赖，覆盖参数校验、体积/节点上限、错误归一、
 *              mtime 冲突、草稿损坏改名与原子写失败分支。
 */
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MainPluginContext } from '@lumin/plugin-api'

import { registerWith, type MindmapDeps } from './node'
import { MAX_DOC_BYTES, MAX_DRAFT_BYTES, MAX_NODES } from './contract'

vi.mock('electron', () => ({ dialog: { showOpenDialogSync: vi.fn() } }))

type Handler = (event: { payload?: unknown }) => unknown

interface FileInfo {
  data: string
  size?: number
  mtimeMs?: number
  isFile?: boolean
}

interface Failures {
  stat?: unknown
  readFile?: unknown
  write?: unknown
  rename?: unknown
  mkdir?: unknown
  unlink?: unknown
}

const USER_DATA = 'C:\\userData'
const DRAFT_PATH = join(USER_DATA, 'mindmap', 'draft.json')

let files: Map<string, FileInfo>
let failures: Failures
let handlers: Map<string, Handler>
let writes: Array<{ target: string; data: string | Buffer }>
let renames: Array<[string, string]>
let mkdirs: string[]
let unlinks: string[]
let log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }

/** 构造带 errno code 的错误 */
function errno(code: string): Error {
  return Object.assign(new Error(code), { code })
}

/** 写入内存文件表 */
function putFile(path: string, info: Partial<FileInfo> & { data: string }): void {
  files.set(path, info)
}

/** 构造注入依赖并注册通道 */
function setup(pickJsonFile: string | null = null): void {
  const deps: MindmapDeps = {
    stat: vi.fn(async (path: string) => {
      if (failures.stat !== undefined) throw failures.stat
      const info = files.get(path)
      if (info === undefined) throw errno('ENOENT')
      return {
        size: info.size ?? Buffer.byteLength(info.data, 'utf8'),
        mtimeMs: info.mtimeMs ?? 1000,
        isFile: () => info.isFile !== false
      }
    }),
    readFile: vi.fn(async (path: string) => {
      if (failures.readFile !== undefined) throw failures.readFile
      const info = files.get(path)
      if (info === undefined) throw errno('ENOENT')
      return Buffer.from(info.data, 'utf8')
    }),
    writeAtomic: (target, data) => {
      if (failures.write !== undefined) throw failures.write
      writes.push({ target, data })
      putFile(target, { data: typeof data === 'string' ? data : data.toString('utf8') })
    },
    rename: vi.fn(async (from: string, to: string) => {
      if (failures.rename !== undefined) throw failures.rename
      renames.push([from, to])
    }),
    mkdir: vi.fn(async (path: string) => {
      if (failures.mkdir !== undefined) throw failures.mkdir
      mkdirs.push(path)
    }),
    unlink: vi.fn(async (path: string) => {
      if (failures.unlink !== undefined) throw failures.unlink
      if (!files.has(path)) throw errno('ENOENT')
      unlinks.push(path)
    }),
    now: () => new Date('2026-11-24T10:20:30.000Z'),
    pickJsonFile: () => pickJsonFile
  }
  const ctx = {
    paths: { userData: USER_DATA, temp: 'C:\\temp', binaries: 'C:\\binaries' },
    registerIpc: (action: string, handler: Handler) => {
      handlers.set(action, handler)
    },
    log
  } as unknown as MainPluginContext
  registerWith(ctx, deps)
}

/** 取通道处理函数 */
function handler(name: string): Handler {
  const found = handlers.get(name)
  if (found === undefined) throw new Error(`missing channel ${name}`)
  return found
}

/** 调用通道 */
async function call(name: string, payload?: unknown): Promise<unknown> {
  return await handler(name)({ payload })
}

/** 生成指定节点数的文档 */
function docWith(count: number, note = ''): Record<string, unknown> {
  return {
    nodeData: {
      id: 'root',
      topic: '根',
      children: Array.from({ length: count - 1 }, (_, i) => ({
        id: `n${i}`,
        topic: 'N',
        ...(note === '' ? {} : { note })
      }))
    }
  }
}

beforeEach(() => {
  files = new Map()
  failures = {}
  handlers = new Map()
  writes = []
  renames = []
  mkdirs = []
  unlinks = []
  log = { info: vi.fn(), warn: vi.fn() }
})

describe('node channels', () => {
  it('注册 8 条通道并写启动日志', () => {
    setup()
    expect([...handlers.keys()].sort()).toEqual([
      'clear-draft',
      'load-draft',
      'open-dialog',
      'open-document',
      'read-text-file',
      'save-document',
      'save-draft',
      'write-export'
    ])
    expect(log.info).toHaveBeenCalledWith('mindmap registered')
  })

  describe('open-dialog', () => {
    it('返回选择路径或 null', async () => {
      setup(null)
      await expect(call('open-dialog')).resolves.toBeNull()
      handlers.clear()
      setup('C:\\a.json')
      await expect(call('open-dialog')).resolves.toEqual({ path: 'C:\\a.json' })
    })
  })

  describe('open-document', () => {
    it('成功读取并去 BOM，返回元信息', async () => {
      putFile('C:\\a.json', {
        data: `\uFEFF${JSON.stringify(docWith(2))}`,
        mtimeMs: 1234,
        size: 99
      })
      setup()
      const result = (await call('open-document', { path: 'C:\\a.json' })) as {
        name: string
        size: number
        mtimeMs: number
        data: { nodeData: { id: string } }
      }
      expect(result.name).toBe('a.json')
      expect(result.size).toBe(99)
      expect(result.mtimeMs).toBe(1234)
      expect(result.data.nodeData.id).toBe('root')
    })

    it('stat/读取错误按 errno 归一', async () => {
      setup()
      failures.stat = errno('ENOENT')
      await expect(call('open-document', { path: 'C:\\a.json' })).rejects.toMatchObject({
        code: 'MM_NOT_FOUND'
      })
      failures.stat = errno('EBUSY')
      await expect(call('open-document', { path: 'C:\\a.json' })).rejects.toMatchObject({
        code: 'MM_LOCKED'
      })
      failures.stat = errno('EACCES')
      await expect(call('open-document', { path: 'C:\\a.json' })).rejects.toMatchObject({
        code: 'MM_READ_FAILED'
      })

      failures = {}
      putFile('C:\\a.json', { data: '{}' })
      failures.readFile = errno('EPERM')
      await expect(call('open-document', { path: 'C:\\a.json' })).rejects.toMatchObject({
        code: 'MM_LOCKED'
      })
      failures.readFile = new Error('boom')
      await expect(call('open-document', { path: 'C:\\a.json' })).rejects.toMatchObject({
        code: 'MM_READ_FAILED'
      })
    })

    it('非文件与超大文件拒绝', async () => {
      putFile('C:\\dir.json', { data: '{}', isFile: false })
      setup()
      await expect(call('open-document', { path: 'C:\\dir.json' })).rejects.toMatchObject({
        code: 'MM_INVALID_PATH'
      })
      putFile('C:\\big.json', { data: '{}', size: MAX_DOC_BYTES + 1 })
      await expect(call('open-document', { path: 'C:\\big.json' })).rejects.toMatchObject({
        code: 'MM_DOC_TOO_LARGE'
      })
    })

    it('JSON 非法 / 结构非法 / 超限分别报错', async () => {
      setup()
      putFile('C:\\bad.json', { data: '{oops' })
      await expect(call('open-document', { path: 'C:\\bad.json' })).rejects.toMatchObject({
        code: 'MM_INVALID_DOCUMENT'
      })
      putFile('C:\\bad2.json', { data: JSON.stringify({ nodeData: [] }) })
      await expect(call('open-document', { path: 'C:\\bad2.json' })).rejects.toMatchObject({
        code: 'MM_INVALID_PAYLOAD'
      })
      putFile('C:\\nodes.json', { data: JSON.stringify(docWith(MAX_NODES + 1)) })
      await expect(call('open-document', { path: 'C:\\nodes.json' })).rejects.toMatchObject({
        code: 'MM_NODE_LIMIT',
        detail: 'nodes'
      })
      const deep: Record<string, unknown> = { id: 'd0', topic: '0', children: [] }
      let current = deep
      for (let level = 1; level <= 60; level += 1) {
        const child: Record<string, unknown> = { id: `d${level}`, topic: 'x', children: [] }
        ;(current.children as Record<string, unknown>[]).push(child)
        current = child
      }
      putFile('C:\\deep.json', { data: JSON.stringify({ nodeData: deep }) })
      await expect(call('open-document', { path: 'C:\\deep.json' })).rejects.toMatchObject({
        code: 'MM_NODE_LIMIT',
        detail: 'depth'
      })
    })

    it('入参非法报 MM_INVALID_PAYLOAD', async () => {
      setup()
      await expect(call('open-document', {})).rejects.toMatchObject({ code: 'MM_INVALID_PAYLOAD' })
    })
  })

  describe('save-document', () => {
    it('无 expectedMtime 时直接写入并回读 mtime', async () => {
      setup()
      const result = (await call('save-document', {
        path: 'C:\\out\\a.json',
        data: docWith(2)
      })) as {
        path: string
        mtimeMs: number
      }
      expect(result.path).toBe('C:\\out\\a.json')
      expect(result.mtimeMs).toBe(1000)
      expect(writes).toHaveLength(1)
      expect(mkdirs).toEqual(['C:\\out'])
      expect(String(writes[0]?.data)).toContain('"nodeData"')
    })

    it('mtime 冲突拒绝，force 放行', async () => {
      putFile('C:\\a.json', { data: '{}', mtimeMs: 50 })
      setup()
      await expect(
        call('save-document', { path: 'C:\\a.json', data: docWith(2), expectedMtimeMs: 40 })
      ).rejects.toMatchObject({ code: 'MM_FILE_CHANGED' })
      await expect(
        call('save-document', {
          path: 'C:\\a.json',
          data: docWith(2),
          expectedMtimeMs: 40,
          force: true
        })
      ).resolves.toMatchObject({ path: 'C:\\a.json' })
    })

    it('expectedMtime 预检：非文件 / 不存在', async () => {
      putFile('C:\\dir.json', { data: '{}', isFile: false })
      setup()
      await expect(
        call('save-document', { path: 'C:\\dir.json', data: docWith(2), expectedMtimeMs: 1 })
      ).rejects.toMatchObject({ code: 'MM_INVALID_PATH' })
      await expect(
        call('save-document', { path: 'C:\\none.json', data: docWith(2), expectedMtimeMs: 1 })
      ).rejects.toMatchObject({ code: 'MM_NOT_FOUND' })
    })

    it('写入成功但 mtime 回读失败时回退当前时间', async () => {
      setup()
      failures.stat = errno('EIO')
      const result = (await call('save-document', {
        path: 'C:\\out\\a.json',
        data: docWith(2)
      })) as {
        mtimeMs: number
      }
      expect(result.mtimeMs).toBe(new Date('2026-11-24T10:20:30.000Z').getTime())
    })

    it('写盘失败按 errno 归一', async () => {
      setup()
      failures.mkdir = errno('EPERM')
      await expect(
        call('save-document', { path: 'C:\\out\\a.json', data: docWith(2) })
      ).rejects.toMatchObject({ code: 'MM_LOCKED' })
      failures = { write: errno('EBUSY') }
      await expect(
        call('save-document', { path: 'C:\\out\\a.json', data: docWith(2) })
      ).rejects.toMatchObject({ code: 'MM_LOCKED' })
      failures = { write: new Error('disk full') }
      await expect(
        call('save-document', { path: 'C:\\out\\a.json', data: docWith(2) })
      ).rejects.toMatchObject({ code: 'MM_SAVE_FAILED' })
      failures = { write: errno('ENOENT') }
      await expect(
        call('save-document', { path: 'C:\\out\\a.json', data: docWith(2) })
      ).rejects.toMatchObject({ code: 'MM_NOT_FOUND' })
    })

    it('序列化后超过文档体积上限报 MM_DOC_TOO_LARGE', async () => {
      setup()
      const note = 'x'.repeat(5000)
      const count = Math.ceil(MAX_DOC_BYTES / 5000) + 10
      await expect(
        call('save-document', { path: 'C:\\out\\a.json', data: docWith(count, note) })
      ).rejects.toMatchObject({ code: 'MM_DOC_TOO_LARGE' })
    })

    it('节点超限与入参非法', async () => {
      setup()
      await expect(
        call('save-document', { path: 'C:\\a.json', data: docWith(MAX_NODES + 1) })
      ).rejects.toMatchObject({ code: 'MM_NODE_LIMIT' })
      await expect(call('save-document', { path: '' })).rejects.toMatchObject({
        code: 'MM_INVALID_PAYLOAD'
      })
    })
  })

  describe('read-text-file', () => {
    it('成功读取去 BOM 并返回元信息', async () => {
      putFile('C:\\a.md', { data: '\uFEFF# 标题', size: 12 })
      setup()
      await expect(call('read-text-file', { path: 'C:\\a.md' })).resolves.toEqual({
        text: '# 标题',
        size: 12,
        name: 'a.md'
      })
    })

    it('错误分支：不存在 / 非文件 / 超大 / 读取失败 / 入参非法', async () => {
      setup()
      await expect(call('read-text-file', { path: 'C:\\none.md' })).rejects.toMatchObject({
        code: 'MM_NOT_FOUND'
      })
      putFile('C:\\dir.md', { data: '', isFile: false })
      await expect(call('read-text-file', { path: 'C:\\dir.md' })).rejects.toMatchObject({
        code: 'MM_INVALID_PATH'
      })
      putFile('C:\\big.md', { data: '', size: MAX_DOC_BYTES + 1 })
      await expect(call('read-text-file', { path: 'C:\\big.md' })).rejects.toMatchObject({
        code: 'MM_DOC_TOO_LARGE'
      })
      putFile('C:\\lock.md', { data: '' })
      failures.readFile = errno('EBUSY')
      await expect(call('read-text-file', { path: 'C:\\lock.md' })).rejects.toMatchObject({
        code: 'MM_LOCKED'
      })
      await expect(call('read-text-file', {})).rejects.toMatchObject({ code: 'MM_INVALID_PAYLOAD' })
    })
  })

  describe('write-export', () => {
    it('文本与 base64 两条写入路径', async () => {
      setup()
      await expect(call('write-export', { path: 'C:\\out\\a.md', text: '# 根' })).resolves.toEqual({
        path: 'C:\\out\\a.md',
        size: 5
      })
      await expect(
        call('write-export', {
          path: 'C:\\out\\a.png',
          base64: Buffer.from('png').toString('base64')
        })
      ).resolves.toEqual({ path: 'C:\\out\\a.png', size: 3 })
      expect(mkdirs).toEqual(['C:\\out', 'C:\\out'])
      expect(writes).toHaveLength(2)
    })

    it('扩展名白名单与 payload 二选一校验', async () => {
      setup()
      await expect(call('write-export', { path: 'C:\\a.exe', text: 'x' })).rejects.toMatchObject({
        code: 'MM_INVALID_PATH'
      })
      await expect(call('write-export', { path: 'C:\\a.md' })).rejects.toMatchObject({
        code: 'MM_INVALID_PAYLOAD'
      })
    })

    it('写入失败报 MM_SAVE_FAILED', async () => {
      setup()
      failures.mkdir = new Error('denied')
      await expect(
        call('write-export', { path: 'C:\\out\\a.md', text: 'x' })
      ).rejects.toMatchObject({
        code: 'MM_SAVE_FAILED'
      })
    })
  })

  describe('load-draft', () => {
    it('不存在返回 empty，其他读取错误归一', async () => {
      setup()
      await expect(call('load-draft')).resolves.toEqual({ status: 'empty' })
      failures.readFile = errno('EBUSY')
      await expect(call('load-draft')).rejects.toMatchObject({ code: 'MM_LOCKED' })
    })

    it('合法草稿返回 ok（含 documentPath）', async () => {
      putFile(DRAFT_PATH, {
        data: JSON.stringify({
          savedAt: '2026-11-24T00:00:00.000Z',
          documentPath: 'C:\\a.json',
          data: docWith(1)
        })
      })
      setup()
      await expect(call('load-draft')).resolves.toMatchObject({
        status: 'ok',
        savedAt: '2026-11-24T00:00:00.000Z',
        documentPath: 'C:\\a.json'
      })
    })

    it('损坏草稿改名留痕并返回 corrupt', async () => {
      putFile(DRAFT_PATH, { data: '{oops' })
      setup()
      await expect(call('load-draft')).resolves.toEqual({ status: 'corrupt' })
      expect(renames).toEqual([
        [DRAFT_PATH, join(USER_DATA, 'mindmap', 'draft.corrupt-20261124182030.json')]
      ])
      expect(log.warn).toHaveBeenCalledWith('草稿损坏，已忽略并保留原文')
    })

    it('改名失败也返回 corrupt 并记两条告警', async () => {
      putFile(DRAFT_PATH, { data: JSON.stringify({ savedAt: 'x', data: { nodeData: [] } }) })
      failures.rename = new Error('locked')
      setup()
      await expect(call('load-draft')).resolves.toEqual({ status: 'corrupt' })
      expect(log.warn).toHaveBeenCalledTimes(2)
    })

    it('草稿超节点上限视为损坏', async () => {
      putFile(DRAFT_PATH, { data: JSON.stringify({ savedAt: 'x', data: docWith(MAX_NODES + 1) }) })
      setup()
      await expect(call('load-draft')).resolves.toEqual({ status: 'corrupt' })
    })
  })

  describe('save-draft', () => {
    it('成功写入含 savedAt 的 JSON', async () => {
      setup()
      const result = (await call('save-draft', {
        data: docWith(2),
        documentPath: 'C:\\a.json'
      })) as {
        savedAt: string
      }
      expect(result.savedAt).toBe('2026-11-24T10:20:30.000Z')
      expect(mkdirs).toEqual([join(USER_DATA, 'mindmap')])
      expect(JSON.parse(String(writes[0]?.data))).toMatchObject({
        savedAt: '2026-11-24T10:20:30.000Z',
        documentPath: 'C:\\a.json'
      })
    })

    it('超过草稿体积 / 节点上限拒绝', async () => {
      setup()
      const note = 'x'.repeat(5000)
      const count = Math.ceil(MAX_DRAFT_BYTES / 5000) + 10
      await expect(call('save-draft', { data: docWith(count, note) })).rejects.toMatchObject({
        code: 'MM_DRAFT_TOO_LARGE'
      })
      await expect(call('save-draft', { data: docWith(MAX_NODES + 1) })).rejects.toMatchObject({
        code: 'MM_NODE_LIMIT'
      })
    })

    it('写入失败与入参非法', async () => {
      setup()
      failures.write = new Error('denied')
      await expect(call('save-draft', { data: docWith(1) })).rejects.toMatchObject({
        code: 'MM_SAVE_FAILED'
      })
      await expect(call('save-draft', {})).rejects.toMatchObject({ code: 'MM_INVALID_PAYLOAD' })
    })
  })

  describe('clear-draft', () => {
    it('存在则删除，不存在视为成功', async () => {
      putFile(DRAFT_PATH, { data: '{}' })
      setup()
      await expect(call('clear-draft')).resolves.toEqual({})
      expect(unlinks).toEqual([DRAFT_PATH])
      unlinks = []
      files.clear()
      await expect(call('clear-draft')).resolves.toEqual({})
      expect(unlinks).toEqual([])
    })

    it('删除失败报 MM_SAVE_FAILED', async () => {
      setup()
      failures.unlink = errno('EPERM')
      await expect(call('clear-draft')).rejects.toMatchObject({ code: 'MM_SAVE_FAILED' })
    })
  })
})
