/**
 * @file node.test.ts 主进程通道单测（7 同步通道 + 存储错误分支，不触真实剪贴板/磁盘）
 * @author cuilanchao
 * @date 2026-11-24
 * @description fs 以内存表注入（writeAtomic 仅在 createDefaultDeps 用例中写临时目录），
 *              覆盖：文本/图片入库判定、SHA-1 去重、图片独立上限、置顶/删除/清空、
 *              防抖与立即落盘、CH_STORAGE_FAILED / CH_IMAGE_MISSING、损坏 JSON 重建、
 *              INVALID_INPUT、孤儿 PNG 清理。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clipboard } from 'electron'
import type { IpcHandler, MainPluginContext } from '@lumin/plugin-api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry, ImageResult, ListResult, OkResult, PollResult } from './schema'
import { MAX_IMAGE_BYTES } from './schema'
import {
  IMAGES_DIR_NAME,
  STORAGE_FILE_NAME,
  createDefaultDeps,
  registerMain,
  registerWith
} from './node'
import type { ClipboardHistoryDeps } from './node'
import type { StorageFs } from './storage'

vi.mock('electron', () => {
  type ThumbImage = {
    resize: (options: { width: number }) => ThumbImage
    toPNG: () => Buffer
  }
  const thumbImage: ThumbImage = {
    resize: vi.fn(() => thumbImage),
    toPNG: vi.fn(() => Buffer.from('thumb-png'))
  }
  const sourceImage = {
    resize: vi.fn(() => thumbImage),
    toPNG: vi.fn(() => Buffer.from('full-png')),
    getSize: vi.fn(() => ({ width: 1920, height: 1080 }))
  }
  return {
    clipboard: {
      readText: vi.fn(() => ''),
      read: vi.fn(() => Promise.resolve([])),
      write: vi.fn(() => Promise.resolve())
    },
    nativeImage: {
      createFromBuffer: vi.fn(() => sourceImage)
    },
    ClipboardItem: class FakeClipboardItem {
      constructor(readonly data: Record<string, unknown>) {}
    }
  }
})

/** 组装带 image/png 的 clipboard.read 回包 */
function readItemsWithPng(bytes: string): Awaited<ReturnType<typeof clipboard.read>> {
  return [
    { types: ['image/png'], getType: vi.fn(() => Promise.resolve(new Blob([bytes]))) }
  ] as unknown as Awaited<ReturnType<typeof clipboard.read>>
}

/** 内存文件系统（单测不触盘） */
interface MemFs extends StorageFs {
  files: Map<string, string>
  writeCount: number
}

function makeMemFs(files: Record<string, string> = {}): MemFs {
  const map = new Map(Object.entries(files))
  const fs: MemFs = {
    files: map,
    writeCount: 0,
    readFile: (path) => {
      const value = map.get(path)
      if (value === undefined) {
        const err = new Error(`ENOENT: no such file, open '${path}'`) as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      }
      return value
    },
    remove: (path) => {
      map.delete(path)
    },
    writeFile: (path, data) => {
      map.set(path, data)
      fs.writeCount += 1
    }
  }
  return fs
}

interface Harness {
  ctx: MainPluginContext
  handlers: Map<string, IpcHandler>
  log: {
    debug: ReturnType<typeof vi.fn>
    info: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
  }
  deps: ClipboardHistoryDeps
  fs: MemFs
}

function makeHarness(
  options: { files?: Record<string, string>; overrides?: Partial<ClipboardHistoryDeps> } = {}
): Harness {
  const handlers = new Map<string, IpcHandler>()
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const ctx = {
    toolId: 'clipboard-history',
    manifest: {},
    registerIpc: (action: string, handler: IpcHandler) => {
      handlers.set(action, handler)
    },
    registerTask: () => undefined,
    settings: { get: vi.fn(), set: vi.fn() },
    log,
    paths: { temp: tmpdir(), userData: tmpdir(), binaries: tmpdir() }
  } as unknown as MainPluginContext
  const fs = makeMemFs(options.files)
  let seq = 0
  const deps: ClipboardHistoryDeps = {
    readClipboardText: vi.fn(() => ''),
    readClipboardImage: vi.fn(() => Promise.resolve(null)),
    makeThumb: vi.fn(() => 'data:image/png;base64,thumb'),
    imageDir: join(tmpdir(), `lumin-ch-images-${Date.now()}`),
    readImageFile: vi.fn(() => {
      const err = new Error("ENOENT: no such file, open 'missing.png'") as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    }),
    writeImageFile: vi.fn(),
    removeImageFile: vi.fn(),
    listImageFiles: vi.fn(() => []),
    filePath: join(tmpdir(), `lumin-ch-${Date.now()}.json`),
    fs,
    now: vi.fn(() => 1_700_000_000_000),
    newId: vi.fn(() => `id-${(seq += 1)}`),
    debounceMs: 0,
    ...options.overrides
  }
  registerWith(ctx, deps)
  return { ctx, handlers, log, deps, fs }
}

async function invoke<T>(
  handlers: Map<string, IpcHandler>,
  action: string,
  payload: unknown
): Promise<T> {
  const handler = handlers.get(action)
  if (handler === undefined) throw new Error(`未注册通道：${action}`)
  return (await handler({ toolId: 'clipboard-history', action, payload })) as T
}

/** 等待防抖定时器（debounceMs = 0 时下一宏任务触发） */
function flushTimer(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10))
}

const HEAD: Entry = { id: 'head', text: '头部条目', createdAt: 100, pinned: false, type: 'text' }
const OTHER: Entry = { id: 'other', text: '非头部条目', createdAt: 50, pinned: false, type: 'text' }

/** 图片条目样本（M61） */
const IMAGE_ENTRY: Entry = {
  id: 'img-1',
  text: '',
  createdAt: 200,
  pinned: false,
  type: 'image',
  width: 1920,
  height: 1080,
  bytes: 1024,
  sha1: 'sha-of-img-1',
  thumb: 'data:image/png;base64,thumb'
}

describe('clipboard-history 7 同步通道', () => {
  it('registerMain 生产入口注册全部通道（默认依赖，首次运行空表）', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'lumin-ch-main-'))
    const handlers = new Map<string, IpcHandler>()
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const ctx = {
      toolId: 'clipboard-history',
      manifest: {},
      registerIpc: (action: string, handler: IpcHandler) => {
        handlers.set(action, handler)
      },
      registerTask: () => undefined,
      settings: { get: vi.fn(), set: vi.fn() },
      log,
      paths: { temp: tmpdir(), userData, binaries: tmpdir() }
    } as unknown as MainPluginContext
    try {
      registerMain(ctx)
      expect([...handlers.keys()].sort()).toEqual([
        'clear',
        'copy',
        'image',
        'list',
        'pin',
        'poll',
        'remove'
      ])
      expect(log.info).toHaveBeenCalledWith('clipboard-history registered')
      const result = await invoke<ListResult>(handlers, 'list', {})
      expect(result.items).toEqual([])
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })

  it('list 首次运行（ENOENT）返回空表', async () => {
    const harness = makeHarness()
    const result = await invoke<ListResult>(harness.handlers, 'list', {})
    expect(result.items).toEqual([])
  })

  it('list 返回置顶前、组内 createdAt 倒序全量', async () => {
    const harness = makeHarness()
    harness.fs.files.set(
      harness.deps.filePath,
      JSON.stringify([OTHER, HEAD, { id: 'p', text: '置顶', createdAt: 10, pinned: true }])
    )
    const result = await invoke<ListResult>(harness.handlers, 'list', {})
    expect(result.items.map((e) => e.id)).toEqual(['p', 'head', 'other'])
  })

  it('list 读失败（非 ENOENT）→ CH_STORAGE_FAILED + 中文文案', async () => {
    const harness = makeHarness()
    vi.spyOn(harness.fs, 'readFile').mockImplementation(() => {
      const err = new Error('permission denied, open') as NodeJS.ErrnoException
      err.code = 'EACCES'
      throw err
    })
    await expect(invoke(harness.handlers, 'list', {})).rejects.toEqual({
      code: 'CH_STORAGE_FAILED',
      message: '剪贴板历史读写失败',
      detail: 'EACCES'
    })
  })

  it('list 读失败无 errno 时 detail 回退 Error.message', async () => {
    const harness = makeHarness()
    vi.spyOn(harness.fs, 'readFile').mockImplementation(() => {
      throw new Error('磁盘通道异常')
    })
    await expect(invoke(harness.handlers, 'list', {})).rejects.toMatchObject({
      code: 'CH_STORAGE_FAILED',
      detail: '磁盘通道异常'
    })
  })

  it('list 读失败抛非 Error 值时 detail 取字符串', async () => {
    const harness = makeHarness()
    vi.spyOn(harness.fs, 'readFile').mockImplementation(() => {
      throw 'raw-failure'
    })
    await expect(invoke(harness.handlers, 'list', {})).rejects.toMatchObject({
      code: 'CH_STORAGE_FAILED',
      detail: 'raw-failure'
    })
  })

  it('list 损坏 JSON → 删除重建空表 + electron-log warn', async () => {
    const harness = makeHarness()
    harness.fs.files.set(harness.deps.filePath, '[{"id":"half')
    const result = await invoke<ListResult>(harness.handlers, 'list', {})
    expect(result.items).toEqual([])
    expect(harness.log.warn).toHaveBeenCalledWith(expect.stringContaining('已重建空表'))
    expect(harness.fs.files.has(harness.deps.filePath)).toBe(false)
  })

  it('list 非法载荷 → INVALID_INPUT（信封校验）', async () => {
    const harness = makeHarness()
    await expect(invoke(harness.handlers, 'list', null)).rejects.toEqual({
      code: 'INVALID_INPUT',
      message: '请求格式无效',
      detail: expect.any(String)
    })
  })

  it('poll 空剪贴板 → entry null 且不写盘', async () => {
    const harness = makeHarness()
    const result = await invoke<PollResult>(harness.handlers, 'poll', {})
    expect(result.entry).toBeNull()
    expect(result.skipped).toBeUndefined()
    expect(harness.fs.writeCount).toBe(0)
  })

  it('poll 新文本 → 入库并防抖落盘', async () => {
    const harness = makeHarness()
    vi.mocked(harness.deps.readClipboardText).mockReturnValue('新复制的文本')
    const result = await invoke<PollResult>(harness.handlers, 'poll', {})
    expect(result.entry).toMatchObject({ text: '新复制的文本', pinned: false })
    expect(result.entry?.id).toBe('id-1')
    await flushTimer()
    const saved = JSON.parse(harness.fs.files.get(harness.deps.filePath) ?? '[]') as Entry[]
    expect(saved).toHaveLength(1)
    expect(saved[0]?.text).toBe('新复制的文本')
  })

  it('poll 与头部条目相同 → 跳过且不写盘', async () => {
    const harness = makeHarness()
    harness.fs.files.set(harness.deps.filePath, JSON.stringify([HEAD]))
    vi.mocked(harness.deps.readClipboardText).mockReturnValue(HEAD.text)
    const result = await invoke<PollResult>(harness.handlers, 'poll', {})
    expect(result.entry).toBeNull()
    await flushTimer()
    expect(harness.fs.writeCount).toBe(0)
  })

  it('poll >100KB → skipped TOO_LARGE 且不入库', async () => {
    const harness = makeHarness()
    vi.mocked(harness.deps.readClipboardText).mockReturnValue('x'.repeat(100 * 1024 + 1))
    const result = await invoke<PollResult>(harness.handlers, 'poll', {})
    expect(result.skipped).toBe('TOO_LARGE')
    expect(result.entry).toBeNull()
    expect((await invoke<ListResult>(harness.handlers, 'list', {})).items).toEqual([])
  })

  it('poll 与非头部条目相同 → 前移去重（条数不变，createdAt 前移）', async () => {
    const harness = makeHarness()
    harness.fs.files.set(harness.deps.filePath, JSON.stringify([HEAD, OTHER]))
    vi.mocked(harness.deps.readClipboardText).mockReturnValue(OTHER.text)
    const result = await invoke<PollResult>(harness.handlers, 'poll', {})
    expect(result.entry).toMatchObject({ id: 'other', createdAt: 1_700_000_000_000 })
    const items = (await invoke<ListResult>(harness.handlers, 'list', {})).items
    expect(items).toHaveLength(2)
    expect(items[0]?.id).toBe('other')
  })

  it('poll 非法载荷 → INVALID_INPUT', async () => {
    const harness = makeHarness()
    await expect(invoke(harness.handlers, 'poll', 'bad')).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    })
  })

  it('pin 切换置顶、立即落盘并覆盖未触发的防抖写', async () => {
    const harness = makeHarness()
    vi.mocked(harness.deps.readClipboardText).mockReturnValue('置顶样本')
    const polled = await invoke<PollResult>(harness.handlers, 'poll', {})
    const id = polled.entry?.id ?? ''
    // 防抖定时器尚未触发，pin 立即落盘应清掉它（仅一次写盘）
    const pinned = await invoke<OkResult>(harness.handlers, 'pin', { id })
    expect(pinned).toEqual({ ok: true })
    await flushTimer()
    expect(harness.fs.writeCount).toBe(1)
    const saved = JSON.parse(harness.fs.files.get(harness.deps.filePath) ?? '[]') as Entry[]
    expect(saved[0]).toMatchObject({ id, pinned: true })
    expect((await invoke<ListResult>(harness.handlers, 'list', {})).items[0]?.pinned).toBe(true)
  })

  it('pin 未知 id → INVALID_INPUT', async () => {
    const harness = makeHarness()
    harness.fs.files.set(harness.deps.filePath, JSON.stringify([HEAD]))
    await expect(invoke(harness.handlers, 'pin', { id: 'missing' })).rejects.toEqual({
      code: 'INVALID_INPUT',
      message: '请求格式无效',
      detail: '条目不存在'
    })
  })

  it('pin 缺 id 载荷 → INVALID_INPUT（信封校验）', async () => {
    const harness = makeHarness()
    await expect(invoke(harness.handlers, 'pin', {})).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    })
  })

  it('remove 删除并立即落盘；未知 id → INVALID_INPUT', async () => {
    const harness = makeHarness()
    harness.fs.files.set(harness.deps.filePath, JSON.stringify([HEAD, OTHER]))
    expect(await invoke<OkResult>(harness.handlers, 'remove', { id: 'head' })).toEqual({ ok: true })
    const items = (await invoke<ListResult>(harness.handlers, 'list', {})).items
    expect(items.map((e) => e.id)).toEqual(['other'])
    const saved = JSON.parse(harness.fs.files.get(harness.deps.filePath) ?? '[]') as Entry[]
    expect(saved.map((e) => e.id)).toEqual(['other'])
    await expect(invoke(harness.handlers, 'remove', { id: 'missing' })).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    })
  })

  it('clear 清空全部（含置顶）并立即落盘', async () => {
    const harness = makeHarness()
    harness.fs.files.set(
      harness.deps.filePath,
      JSON.stringify([HEAD, { id: 'p', text: '置顶', createdAt: 1, pinned: true }])
    )
    expect(await invoke<OkResult>(harness.handlers, 'clear', {})).toEqual({ ok: true })
    expect((await invoke<ListResult>(harness.handlers, 'list', {})).items).toEqual([])
    expect(harness.fs.files.get(harness.deps.filePath)).toBe('[]')
  })

  it('落盘失败 → CH_STORAGE_FAILED 且内存态继续（重试可读到已改状态）', async () => {
    const harness = makeHarness()
    harness.fs.files.set(harness.deps.filePath, JSON.stringify([HEAD]))
    vi.spyOn(harness.fs, 'writeFile').mockImplementation(() => {
      const err = new Error('no space left on device') as NodeJS.ErrnoException
      err.code = 'ENOSPC'
      throw err
    })
    await expect(invoke(harness.handlers, 'pin', { id: 'head' })).rejects.toEqual({
      code: 'CH_STORAGE_FAILED',
      message: '剪贴板历史读写失败',
      detail: 'ENOSPC'
    })
    // 内存态继续：未落盘但状态已生效
    expect((await invoke<ListResult>(harness.handlers, 'list', {})).items[0]?.pinned).toBe(true)
  })

  it('防抖落盘失败 → electron-log warn 且不向外抛出', async () => {
    const harness = makeHarness()
    vi.mocked(harness.deps.readClipboardText).mockReturnValue('后台写失败样本')
    vi.spyOn(harness.fs, 'writeFile').mockImplementation(() => {
      throw new Error('EPERM')
    })
    const result = await invoke<PollResult>(harness.handlers, 'poll', {})
    expect(result.entry?.text).toBe('后台写失败样本')
    await flushTimer()
    expect(harness.log.warn).toHaveBeenCalledWith('剪贴板历史持久化失败', expect.any(Error))
  })
})

describe('M61 图片分支与 image/copy 通道', () => {
  const PNG = Buffer.from('clipboard-image-png-bytes')
  const SHA1 = createHash('sha1').update(PNG).digest('hex')

  beforeEach(() => {
    vi.mocked(clipboard.write).mockClear()
  })

  /** 注入图片剪贴板（图片优先判定）的 harness */
  function withImage(overrides: Partial<ClipboardHistoryDeps> = {}): Harness {
    return makeHarness({
      overrides: {
        readClipboardImage: async () => ({ png: PNG, width: 800, height: 600 }),
        ...overrides
      }
    })
  }

  it('poll 图片优先：图片分支入库、先写 PNG 再防抖写 JSON、不读文本', async () => {
    const harness = withImage()
    const result = await invoke<PollResult>(harness.handlers, 'poll', {})
    expect(result.entry).toMatchObject({
      type: 'image',
      text: '',
      width: 800,
      height: 600,
      bytes: PNG.length,
      sha1: SHA1
    })
    expect(result.entry?.id).toBe('id-1')
    expect(harness.deps.writeImageFile).toHaveBeenCalledWith('id-1', PNG)
    expect(harness.deps.readClipboardText).not.toHaveBeenCalled()
    expect(harness.deps.makeThumb).toHaveBeenCalledWith(PNG, 800)
    await flushTimer()
    const saved = JSON.parse(harness.fs.files.get(harness.deps.filePath) ?? '[]') as Entry[]
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ id: 'id-1', type: 'image' })
  })

  it('poll 图片 >5MB → skipped TOO_LARGE 且不写文件不写盘', async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1)
    const harness = withImage({
      readClipboardImage: async () => ({ png: big, width: 1, height: 1 })
    })
    const result = await invoke<PollResult>(harness.handlers, 'poll', {})
    expect(result.skipped).toBe('TOO_LARGE')
    expect(result.entry).toBeNull()
    expect(harness.deps.writeImageFile).not.toHaveBeenCalled()
    await flushTimer()
    expect(harness.fs.writeCount).toBe(0)
  })

  it('poll 图片与头部图片 SHA-1 相同 → 跳过（不写文件不写盘）', async () => {
    const harness = withImage()
    harness.fs.files.set(harness.deps.filePath, JSON.stringify([{ ...IMAGE_ENTRY, sha1: SHA1 }]))
    const result = await invoke<PollResult>(harness.handlers, 'poll', {})
    expect(result.entry).toBeNull()
    expect(result.skipped).toBeUndefined()
    expect(harness.deps.writeImageFile).not.toHaveBeenCalled()
    await flushTimer()
    expect(harness.fs.writeCount).toBe(0)
  })

  it('image 通道：返回原图 dataURL（打开预览时按需读取）', async () => {
    const harness = makeHarness({ overrides: { readImageFile: vi.fn(() => PNG) } })
    harness.fs.files.set(harness.deps.filePath, JSON.stringify([IMAGE_ENTRY]))
    const result = await invoke<ImageResult>(harness.handlers, 'image', { id: 'img-1' })
    expect(result.dataUrl).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
  })

  it('image 通道：PNG 文件缺失 → CH_IMAGE_MISSING 中文文案', async () => {
    const harness = makeHarness()
    harness.fs.files.set(harness.deps.filePath, JSON.stringify([IMAGE_ENTRY]))
    await expect(invoke(harness.handlers, 'image', { id: 'img-1' })).rejects.toEqual({
      code: 'CH_IMAGE_MISSING',
      message: '图片文件已丢失'
    })
  })

  it('image 通道：非图片条目 / 未知 id / 缺 id 载荷 → INVALID_INPUT', async () => {
    const harness = makeHarness()
    harness.fs.files.set(harness.deps.filePath, JSON.stringify([HEAD]))
    await expect(invoke(harness.handlers, 'image', { id: 'head' })).rejects.toEqual({
      code: 'INVALID_INPUT',
      message: '请求格式无效',
      detail: '条目不存在'
    })
    await expect(invoke(harness.handlers, 'image', { id: 'missing' })).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    })
    await expect(invoke(harness.handlers, 'image', {})).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    })
  })

  it('copy 通道：读 PNG 经 clipboard.write(clipboard-item) 回写', async () => {
    const harness = makeHarness({ overrides: { readImageFile: vi.fn(() => PNG) } })
    harness.fs.files.set(harness.deps.filePath, JSON.stringify([IMAGE_ENTRY]))
    expect(await invoke<OkResult>(harness.handlers, 'copy', { id: 'img-1' })).toEqual({ ok: true })
    expect(clipboard.write).toHaveBeenCalledTimes(1)
    const written = vi.mocked(clipboard.write).mock.calls[0]?.[0]
    expect(written).toHaveLength(1)
  })

  it('copy 通道：PNG 文件缺失 → CH_IMAGE_MISSING（不触剪贴板）', async () => {
    const harness = makeHarness()
    harness.fs.files.set(harness.deps.filePath, JSON.stringify([IMAGE_ENTRY]))
    await expect(invoke(harness.handlers, 'copy', { id: 'img-1' })).rejects.toEqual({
      code: 'CH_IMAGE_MISSING',
      message: '图片文件已丢失'
    })
    expect(clipboard.write).not.toHaveBeenCalled()
  })

  it('remove 图片条目：同步删 PNG，删除失败仅 warn 不阻断', async () => {
    const harness = makeHarness({
      overrides: {
        removeImageFile: vi.fn(() => {
          throw new Error('EPERM')
        })
      }
    })
    harness.fs.files.set(harness.deps.filePath, JSON.stringify([IMAGE_ENTRY, HEAD]))
    expect(await invoke<OkResult>(harness.handlers, 'remove', { id: 'img-1' })).toEqual({
      ok: true
    })
    expect(harness.deps.removeImageFile).toHaveBeenCalledWith('img-1')
    expect(harness.log.warn).toHaveBeenCalledWith('剪贴板图片文件删除失败', expect.any(Error))
    const items = (await invoke<ListResult>(harness.handlers, 'list', {})).items
    expect(items.map((e) => e.id)).toEqual(['head'])
  })

  it('remove 文本条目不触发图片文件删除', async () => {
    const harness = makeHarness()
    harness.fs.files.set(harness.deps.filePath, JSON.stringify([IMAGE_ENTRY, HEAD]))
    await invoke<OkResult>(harness.handlers, 'remove', { id: 'head' })
    expect(harness.deps.removeImageFile).not.toHaveBeenCalled()
  })

  it('clear：全部图片文件同步删除 + JSON 清空', async () => {
    const harness = makeHarness()
    harness.fs.files.set(
      harness.deps.filePath,
      JSON.stringify([IMAGE_ENTRY, { ...IMAGE_ENTRY, id: 'img-2' }, HEAD])
    )
    expect(await invoke<OkResult>(harness.handlers, 'clear', {})).toEqual({ ok: true })
    expect(harness.deps.removeImageFile).toHaveBeenCalledWith('img-1')
    expect(harness.deps.removeImageFile).toHaveBeenCalledWith('img-2')
    expect(harness.fs.files.get(harness.deps.filePath)).toBe('[]')
  })

  it('加载后孤儿 PNG 清理：JSON 未引用即删 + warn', async () => {
    const harness = makeHarness({
      overrides: { listImageFiles: vi.fn(() => ['img-1.png', 'orphan.png', 'note.txt']) }
    })
    harness.fs.files.set(harness.deps.filePath, JSON.stringify([IMAGE_ENTRY]))
    await invoke<ListResult>(harness.handlers, 'list', {})
    expect(harness.deps.removeImageFile).toHaveBeenCalledWith('orphan')
    expect(harness.deps.removeImageFile).toHaveBeenCalledTimes(1)
    expect(harness.log.warn).toHaveBeenCalledWith('已清理孤儿剪贴板图片 1 个')
  })

  it('孤儿清理：目录不存在（ENOENT）静默且不告警', async () => {
    const harness = makeHarness({
      overrides: {
        listImageFiles: vi.fn(() => {
          const err = new Error('ENOENT: scandir') as NodeJS.ErrnoException
          err.code = 'ENOENT'
          throw err
        })
      }
    })
    expect((await invoke<ListResult>(harness.handlers, 'list', {})).items).toEqual([])
    expect(harness.log.warn).not.toHaveBeenCalled()
  })

  it('孤儿清理：其他目录错误仅 warn 不阻断 list', async () => {
    const harness = makeHarness({
      overrides: {
        listImageFiles: vi.fn(() => {
          const err = new Error('permission denied') as NodeJS.ErrnoException
          err.code = 'EACCES'
          throw err
        })
      }
    })
    expect((await invoke<ListResult>(harness.handlers, 'list', {})).items).toEqual([])
    expect(harness.log.warn).toHaveBeenCalledWith('孤儿剪贴板图片清理失败', expect.any(Error))
  })
})

describe('createDefaultDeps', () => {
  const created: string[] = []

  afterEach(() => {
    for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true })
  })

  it('生产依赖：userData 路径 + electron 剪贴板 + node fs + 原子写', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'lumin-ch-deps-'))
    created.push(userData)
    const ctx = {
      toolId: 'clipboard-history',
      manifest: {},
      registerIpc: () => undefined,
      registerTask: () => undefined,
      settings: { get: vi.fn(), set: vi.fn() },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      paths: { temp: tmpdir(), userData, binaries: tmpdir() }
    } as unknown as MainPluginContext
    const deps = createDefaultDeps(ctx)

    expect(deps.filePath).toBe(join(userData, STORAGE_FILE_NAME))
    vi.mocked(clipboard.readText).mockResolvedValueOnce('生产剪贴板文本')
    await expect(deps.readClipboardText()).resolves.toBe('生产剪贴板文本')

    // 原子写 → 真实临时目录
    deps.fs.writeFile(deps.filePath, '[{"id":"a"}]')
    created.push(deps.filePath)
    expect(existsSync(deps.filePath)).toBe(true)
    expect(readFileSync(deps.filePath, 'utf8')).toBe('[{"id":"a"}]')
    expect(deps.fs.readFile(deps.filePath)).toBe('[{"id":"a"}]')
    expect(() => deps.fs.readFile(join(userData, 'no-such-file.json'))).toThrow()

    deps.fs.remove(deps.filePath)
    expect(existsSync(deps.filePath)).toBe(false)
    expect(() => deps.fs.remove(deps.filePath)).not.toThrow()

    expect(deps.now()).toBeGreaterThan(0)
    expect(deps.newId()).toMatch(/^[0-9a-f-]{36}$/)

    // 图片能力：目录路径 + 剪贴板图片读取（Electron 45 W3C 口径：read 找 image/png）+ 缩略图 + PNG 文件读写删列
    expect(deps.imageDir).toBe(join(userData, IMAGES_DIR_NAME))

    vi.mocked(clipboard.read).mockResolvedValueOnce([])
    expect(await deps.readClipboardImage()).toBeNull()

    // 仅文本无图片 → null
    vi.mocked(clipboard.read).mockResolvedValueOnce([
      { types: ['text/plain'], getType: vi.fn(() => Promise.resolve(new Blob(['txt']))) }
    ] as unknown as Awaited<ReturnType<typeof clipboard.read>>)
    expect(await deps.readClipboardImage()).toBeNull()

    // 含 image/png → 返回 PNG 与 nativeImage 解析出的尺寸
    vi.mocked(clipboard.read).mockResolvedValueOnce(readItemsWithPng('clip-png'))
    expect(await deps.readClipboardImage()).toEqual({
      png: Buffer.from('clip-png'),
      width: 1920,
      height: 1080
    })

    // 空 PNG 负载 → 视为无图
    vi.mocked(clipboard.read).mockResolvedValueOnce(readItemsWithPng(''))
    expect(await deps.readClipboardImage()).toBeNull()

    const wideThumb = deps.makeThumb(Buffer.from('x'), 1920)
    const narrowThumb = deps.makeThumb(Buffer.from('x'), 100)
    expect(wideThumb.startsWith('data:image/png;base64,')).toBe(true)
    expect(narrowThumb.startsWith('data:image/png;base64,')).toBe(true)
    // 超 160 宽走 resize 缩略图，窄图保持原图（两者 PNG 不同）
    expect(wideThumb).not.toBe(narrowThumb)

    deps.writeImageFile('img-1', Buffer.from('png-bytes'))
    expect(deps.listImageFiles()).toEqual(['img-1.png'])
    expect(deps.readImageFile('img-1')).toEqual(Buffer.from('png-bytes'))
    deps.removeImageFile('img-1')
    expect(deps.listImageFiles()).toEqual([])
    expect(() => deps.removeImageFile('img-1')).not.toThrow()
    expect(() => deps.readImageFile('missing')).toThrow()
  })
})

describe('registerWith 默认依赖参数', () => {
  beforeEach(() => {
    vi.mocked(clipboard.readText).mockResolvedValue('')
  })

  it('省略 deps 时走 createDefaultDeps（壳启动路径）', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'lumin-ch-default-'))
    const handlers = new Map<string, IpcHandler>()
    const ctx = {
      toolId: 'clipboard-history',
      manifest: {},
      registerIpc: (action: string, handler: IpcHandler) => {
        handlers.set(action, handler)
      },
      registerTask: () => undefined,
      settings: { get: vi.fn(), set: vi.fn() },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      paths: { temp: tmpdir(), userData, binaries: tmpdir() }
    } as unknown as MainPluginContext
    try {
      registerWith(ctx)
      const result = await invoke<ListResult>(handlers, 'list', {})
      expect(result.items).toEqual([])
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
