/**
 * @file node.test.ts 主进程通道单测（pick-file / compare-files / copy-text，deps 注入不触真实对话框/磁盘）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖：通道注册、pick-file 回填与取消、INVALID_INPUT 信封、
 *              classifyFile 三条件与 BOM/UTF-16 分支、文本模式（标签/行/忽略选项/UTF-8 BOM）、
 *              200MB 上限、TD_FILE_READ_FAILED 注入、行数兜底 TD_TOO_LARGE、
 *              二进制首差异偏移（同块/跨块/一侧读尽）与相同判定、
 *              非法 UTF-8 → TD_UNSUPPORTED_ENCODING、createDefaultDeps 生产依赖。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clipboard, dialog } from 'electron'
import type { IpcHandler, MainPluginContext } from '@lumin/plugin-api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BINARY_CHUNK_BYTES, COPY_TEXT_MAX_CHARS, FILE_COMPARE_MAX_BYTES } from './schema'
import type { CompareFilesResult, PickFileResult } from './schema'
import { DIFF_LINE_LIMIT, TEXT_FILE_MAX_BYTES, classifyFile } from './diff'
import { createDefaultDeps, registerMain, registerWith } from './node'
import type { TextDiffNodeDeps } from './node'
import { toolError } from './errors'

vi.mock('electron', () => ({
  dialog: { showOpenDialogSync: vi.fn() },
  clipboard: { writeText: vi.fn() }
}))

/** 构造 ENOENT 异常（内存 fs 未命中时抛出） */
function enoent(path: string): NodeJS.ErrnoException {
  const err = new Error(`ENOENT: no such file, open '${path}'`) as NodeJS.ErrnoException
  err.code = 'ENOENT'
  return err
}

/** 内存文件依赖（path → 内容；statSize 取内容长度） */
function makeDeps(
  files: Record<string, Buffer | string> = {},
  overrides: Partial<TextDiffNodeDeps> = {}
): TextDiffNodeDeps {
  const map = new Map<string, Buffer>()
  for (const [path, content] of Object.entries(files)) {
    map.set(path, typeof content === 'string' ? Buffer.from(content) : content)
  }
  const deps: TextDiffNodeDeps = {
    pickFilePath: vi.fn(() => null),
    statSize: (path) => {
      const content = map.get(path)
      if (content === undefined) throw enoent(path)
      return content.length
    },
    readWholeFile: (path) => {
      const content = map.get(path)
      if (content === undefined) throw enoent(path)
      return content
    },
    readChunks: (path) => {
      const content = map.get(path)
      if (content === undefined) throw enoent(path)
      if (content.length === 0) return []
      return [content]
    },
    writeClipboard: vi.fn(),
    ...overrides
  }
  return deps
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
  deps: TextDiffNodeDeps
}

function makeHarness(
  files: Record<string, Buffer | string> = {},
  overrides: Partial<TextDiffNodeDeps> = {}
): Harness {
  const handlers = new Map<string, IpcHandler>()
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const ctx = {
    toolId: 'text-diff',
    manifest: {},
    registerIpc: (action: string, handler: IpcHandler) => {
      handlers.set(action, handler)
    },
    registerTask: () => undefined,
    settings: { get: vi.fn(), set: vi.fn() },
    log,
    paths: { temp: tmpdir(), userData: tmpdir(), binaries: tmpdir() }
  } as unknown as MainPluginContext
  const deps = makeDeps(files, overrides)
  registerWith(ctx, deps)
  return { ctx, handlers, log, deps }
}

async function invoke<T>(
  handlers: Map<string, IpcHandler>,
  action: string,
  payload: unknown
): Promise<T> {
  const handler = handlers.get(action)
  if (handler === undefined) throw new Error(`未注册通道：${action}`)
  return (await handler({ toolId: 'text-diff', action, payload })) as T
}

/** 捕获同步抛出的结构化错误（throw 的是普通对象，toThrow 不适用） */
function catchThrown(fn: () => unknown): unknown {
  try {
    fn()
  } catch (err) {
    return err
  }
  return undefined
}

/** 文本模式回包收窄断言用 */
function asText(result: CompareFilesResult): Extract<CompareFilesResult, { mode: 'text' }> {
  if (result.mode !== 'text') throw new Error('期望文本模式回包')
  return result
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('通道注册', () => {
  it('registerMain 注册三同步通道并记录日志（默认依赖）', () => {
    const handlers = new Map<string, IpcHandler>()
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const ctx = {
      toolId: 'text-diff',
      manifest: {},
      registerIpc: (action: string, handler: IpcHandler) => {
        handlers.set(action, handler)
      },
      registerTask: () => undefined,
      settings: { get: vi.fn(), set: vi.fn() },
      log,
      paths: { temp: tmpdir(), userData: tmpdir(), binaries: tmpdir() }
    } as unknown as MainPluginContext
    registerMain(ctx)
    expect([...handlers.keys()].sort()).toEqual(['compare-files', 'copy-text', 'pick-file'])
    expect(log.info).toHaveBeenCalledWith('text-toolbox diff registered')
  })
})

describe('pick-file 通道', () => {
  it('选择成功返回绝对路径', async () => {
    const harness = makeHarness({}, { pickFilePath: vi.fn(() => 'C:/tmp/pick.txt') })
    const result = await invoke<PickFileResult>(harness.handlers, 'pick-file', {})
    expect(result).toEqual({ path: 'C:/tmp/pick.txt' })
  })

  it('用户取消返回 null', async () => {
    const harness = makeHarness()
    const result = await invoke<PickFileResult>(harness.handlers, 'pick-file', {})
    expect(result).toEqual({ path: null })
  })

  it('非法载荷 → INVALID_INPUT（信封校验）', async () => {
    const harness = makeHarness()
    await expect(invoke(harness.handlers, 'pick-file', null)).rejects.toEqual({
      code: 'INVALID_INPUT',
      message: '请求格式无效',
      detail: expect.any(String)
    })
  })
})

describe('copy-text 通道', () => {
  it('写入系统剪贴板并回包 ok', async () => {
    const writeClipboard = vi.fn()
    const harness = makeHarness({}, { writeClipboard })
    await expect(
      invoke(harness.handlers, 'copy-text', { text: '+++ 右侧\n-香蕉' })
    ).resolves.toEqual({ ok: true })
    expect(writeClipboard).toHaveBeenCalledWith('+++ 右侧\n-香蕉')
  })

  it('剪贴板异常 → TD_CLIPBOARD_FAILED', async () => {
    const harness = makeHarness(
      {},
      {
        writeClipboard: vi.fn(() => {
          throw new Error('clipboard unavailable')
        })
      }
    )
    await expect(invoke(harness.handlers, 'copy-text', { text: 'x' })).rejects.toMatchObject({
      code: 'TD_CLIPBOARD_FAILED',
      detail: 'clipboard unavailable'
    })
  })

  it('空文本 / 超长文本 → INVALID_INPUT', async () => {
    const harness = makeHarness()
    await expect(invoke(harness.handlers, 'copy-text', { text: '' })).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    })
    await expect(
      invoke(harness.handlers, 'copy-text', { text: 'x'.repeat(COPY_TEXT_MAX_CHARS + 1) })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})

describe('compare-files 信封校验', () => {
  it('null 载荷 / 缺失路径 / 空路径 → INVALID_INPUT', async () => {
    const harness = makeHarness({ 'a.txt': 'a', 'b.txt': 'b' })
    for (const payload of [null, { left: 'a.txt' }, { left: '', right: 'b.txt' }]) {
      await expect(invoke(harness.handlers, 'compare-files', payload)).rejects.toMatchObject({
        code: 'INVALID_INPUT'
      })
    }
  })
})

describe('classifyFile（M62 模式判定纯函数）', () => {
  it('三条件：size >1MB / 前 8KB 含 NUL / 行数超 20,000 → 二进制', () => {
    expect(classifyFile(Buffer.alloc(0), TEXT_FILE_MAX_BYTES + 1)).toBe('binary')
    expect(classifyFile(Buffer.from('ab\0cd'), 5)).toBe('binary')
    expect(classifyFile(Buffer.alloc(DIFF_LINE_LIMIT + 1, 0x0a), DIFF_LINE_LIMIT + 1)).toBe(
      'binary'
    )
  })

  it('常规 UTF-8 文本、UTF-8 BOM、空文件 → 文本', () => {
    expect(classifyFile(Buffer.from('hello\nworld'), 12)).toBe('text')
    expect(classifyFile(Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69]), 5)).toBe('text')
    expect(classifyFile(Buffer.alloc(0), 0)).toBe('text')
  })

  it('UTF-16 LE/BE 与 UTF-32 BOM → TD_UNSUPPORTED_ENCODING', () => {
    expect(catchThrown(() => classifyFile(Buffer.from([0xff, 0xfe, 0x41, 0x00]), 4))).toEqual(
      toolError('TD_UNSUPPORTED_ENCODING')
    )
    expect(catchThrown(() => classifyFile(Buffer.from([0xfe, 0xff, 0x00, 0x41]), 4))).toEqual(
      toolError('TD_UNSUPPORTED_ENCODING')
    )
    expect(catchThrown(() => classifyFile(Buffer.from([0x00, 0x00, 0xfe, 0xff]), 4))).toEqual(
      toolError('TD_UNSUPPORTED_ENCODING')
    )
    expect(catchThrown(() => classifyFile(Buffer.from([0xff, 0xfe, 0x00, 0x00]), 4))).toEqual(
      toolError('TD_UNSUPPORTED_ENCODING')
    )
  })
})

describe('compare-files 文本模式', () => {
  it('行级结果、统计、文件名标签与行数组', async () => {
    const harness = makeHarness({ 'dir/left.txt': 'a\nb\n', 'dir/right.txt': 'a\nc\n' })
    const result = await invoke<CompareFilesResult>(harness.handlers, 'compare-files', {
      left: 'dir/left.txt',
      right: 'dir/right.txt'
    })
    const text = asText(result)
    expect(text.stats).toEqual({ added: 1, removed: 1, unchanged: 1 })
    expect(text.leftLabel).toBe('left.txt')
    expect(text.rightLabel).toBe('right.txt')
    expect(text.leftLines).toEqual(['a', 'b'])
    expect(text.rightLines).toEqual(['a', 'c'])
    expect(text.changes.map((item) => item.type)).toEqual(['equal', 'delete', 'insert'])
  })

  it('忽略空白选项从 payload 传入生效，缺省 false 按原样比较', async () => {
    const files = { 'left.txt': 'a b', 'right.txt': 'ab' }
    const strict = asText(
      await invoke<CompareFilesResult>(makeHarness(files).handlers, 'compare-files', {
        left: 'left.txt',
        right: 'right.txt'
      })
    )
    expect(strict.stats).toEqual({ added: 1, removed: 1, unchanged: 0 })

    const loose = asText(
      await invoke<CompareFilesResult>(makeHarness(files).handlers, 'compare-files', {
        left: 'left.txt',
        right: 'right.txt',
        ignoreWhitespace: true
      })
    )
    expect(loose.stats).toEqual({ added: 0, removed: 0, unchanged: 1 })
  })

  it('UTF-8 BOM 剥离后参与比较', async () => {
    const harness = makeHarness({
      'left.txt': Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0a]),
      'right.txt': 'a\n'
    })
    const text = asText(
      await invoke<CompareFilesResult>(harness.handlers, 'compare-files', {
        left: 'left.txt',
        right: 'right.txt'
      })
    )
    expect(text.stats).toEqual({ added: 0, removed: 0, unchanged: 1 })
    expect(text.leftLines).toEqual(['a'])
  })

  it('行数超限由 diffLines 兜底 → TD_TOO_LARGE', async () => {
    const many = Array.from({ length: DIFF_LINE_LIMIT + 1 }, () => 'x').join('\n')
    const harness = makeHarness({ 'left.txt': many, 'right.txt': many })
    await expect(
      invoke(harness.handlers, 'compare-files', { left: 'left.txt', right: 'right.txt' })
    ).rejects.toMatchObject({ code: 'TD_TOO_LARGE' })
  })
})

describe('compare-files 错误码', () => {
  it('stat 预检超过 200MB → TD_FILE_TOO_LARGE', async () => {
    const harness = makeHarness(
      {},
      { statSize: (path) => (path === 'right.bin' ? FILE_COMPARE_MAX_BYTES + 1 : 10) }
    )
    await expect(
      invoke(harness.handlers, 'compare-files', { left: 'left.bin', right: 'right.bin' })
    ).rejects.toEqual({
      code: 'TD_FILE_TOO_LARGE',
      message: '文件过大，单文件最大 200MB',
      detail: `${FILE_COMPARE_MAX_BYTES + 1} bytes`
    })
  })

  it('路径不存在（stat ENOENT）→ TD_FILE_READ_FAILED + errno detail', async () => {
    const harness = makeHarness()
    await expect(
      invoke(harness.handlers, 'compare-files', { left: 'missing.txt', right: 'also.txt' })
    ).rejects.toEqual({
      code: 'TD_FILE_READ_FAILED',
      message: '文件读取失败，请检查路径是否存在及读取权限',
      detail: 'ENOENT'
    })
  })

  it('读入失败无 errno 时 detail 回退 Error.message', async () => {
    const harness = makeHarness(
      {},
      {
        statSize: () => 10,
        readWholeFile: () => {
          throw new Error('磁盘通道异常')
        }
      }
    )
    await expect(
      invoke(harness.handlers, 'compare-files', { left: 'a.txt', right: 'b.txt' })
    ).rejects.toMatchObject({ code: 'TD_FILE_READ_FAILED', detail: '磁盘通道异常' })
  })

  it('抛出非 Error 值时 detail 取字符串', async () => {
    const harness = makeHarness(
      {},
      {
        statSize: () => 10,
        readWholeFile: () => {
          throw 'raw-failure'
        }
      }
    )
    await expect(
      invoke(harness.handlers, 'compare-files', { left: 'a.txt', right: 'b.txt' })
    ).rejects.toMatchObject({ code: 'TD_FILE_READ_FAILED', detail: 'raw-failure' })
  })

  it('deps 抛结构化错误原样透传', async () => {
    const harness = makeHarness(
      {},
      {
        statSize: () => {
          throw toolError('TD_FILE_TOO_LARGE', 'injected')
        }
      }
    )
    await expect(
      invoke(harness.handlers, 'compare-files', { left: 'a.txt', right: 'b.txt' })
    ).rejects.toEqual({
      code: 'TD_FILE_TOO_LARGE',
      message: '文件过大，单文件最大 200MB',
      detail: 'injected'
    })
  })

  it('非法 UTF-8 字节序列 → TD_UNSUPPORTED_ENCODING', async () => {
    const harness = makeHarness({
      'left.txt': Buffer.from([0x61, 0xc3, 0x28]),
      'right.txt': 'ok'
    })
    await expect(
      invoke(harness.handlers, 'compare-files', { left: 'left.txt', right: 'right.txt' })
    ).rejects.toMatchObject({ code: 'TD_UNSUPPORTED_ENCODING' })
  })

  it('UTF-16 BOM 文件对 → TD_UNSUPPORTED_ENCODING', async () => {
    const harness = makeHarness({
      'left.txt': Buffer.from([0xff, 0xfe, 0x61, 0x00]),
      'right.txt': Buffer.from([0xff, 0xfe, 0x62, 0x00])
    })
    await expect(
      invoke(harness.handlers, 'compare-files', { left: 'left.txt', right: 'right.txt' })
    ).rejects.toMatchObject({ code: 'TD_UNSUPPORTED_ENCODING' })
  })
})

describe('compare-files 二进制模式', () => {
  it('含 NUL 的小文件对：同块字节级定位首差异偏移', async () => {
    const harness = makeHarness({ 'left.bin': 'AB\0CD', 'right.bin': 'AB\0XD' })
    const result = await invoke<CompareFilesResult>(harness.handlers, 'compare-files', {
      left: 'left.bin',
      right: 'right.bin'
    })
    expect(result).toEqual({ mode: 'binary', same: false, firstDiffOffset: 3, totalChunks: 1 })
  })

  it('完全相同的二进制对 → same true 且无偏移', async () => {
    const harness = makeHarness({ 'left.bin': 'A\0B', 'right.bin': 'A\0B' })
    const result = await invoke<CompareFilesResult>(harness.handlers, 'compare-files', {
      left: 'left.bin',
      right: 'right.bin'
    })
    expect(result).toEqual({ mode: 'binary', same: true, totalChunks: 1 })
  })

  it('左短右长且左为前缀 → 首差异在左文件末尾', async () => {
    const harness = makeHarness({ 'left.bin': 'he\0llo', 'right.bin': 'he\0llo world' })
    const result = await invoke<CompareFilesResult>(harness.handlers, 'compare-files', {
      left: 'left.bin',
      right: 'right.bin'
    })
    expect(result).toEqual({ mode: 'binary', same: false, firstDiffOffset: 6, totalChunks: 1 })
  })

  it('一侧为空文件 → 首差异偏移 0', async () => {
    const emptyLeft = await invoke<CompareFilesResult>(
      makeHarness({ 'left.bin': Buffer.alloc(0), 'right.bin': 'a\0b' }).handlers,
      'compare-files',
      { left: 'left.bin', right: 'right.bin' }
    )
    expect(emptyLeft).toEqual({ mode: 'binary', same: false, firstDiffOffset: 0, totalChunks: 1 })

    const emptyRight = await invoke<CompareFilesResult>(
      makeHarness({ 'left.bin': 'a\0b', 'right.bin': Buffer.alloc(0) }).handlers,
      'compare-files',
      { left: 'left.bin', right: 'right.bin' }
    )
    expect(emptyRight).toEqual({ mode: 'binary', same: false, firstDiffOffset: 0, totalChunks: 1 })
  })

  it('跨块：首块差异 + 后续块跳过比对', async () => {
    const chunk0Left = Buffer.alloc(BINARY_CHUNK_BYTES, 1)
    const chunk0Right = Buffer.alloc(BINARY_CHUNK_BYTES, 1)
    chunk0Right[7] = 9
    const tailLeft = Buffer.alloc(64, 7)
    const tailRight = Buffer.alloc(64, 7)
    const harness = makeHarness(
      {
        'big-left.bin': Buffer.alloc(BINARY_CHUNK_BYTES + 64, 1),
        'big-right.bin': Buffer.alloc(BINARY_CHUNK_BYTES + 64, 1)
      },
      {
        readChunks: (path) =>
          path === 'big-left.bin' ? [chunk0Left, tailLeft] : [chunk0Right, tailRight]
      }
    )
    const result = await invoke<CompareFilesResult>(harness.handlers, 'compare-files', {
      left: 'big-left.bin',
      right: 'big-right.bin'
    })
    expect(result).toEqual({ mode: 'binary', same: false, firstDiffOffset: 7, totalChunks: 2 })
  })

  it('跨块：首块相同、次块差异按块序换算偏移', async () => {
    const chunk0Left = Buffer.alloc(BINARY_CHUNK_BYTES, 1)
    const chunk0Right = Buffer.alloc(BINARY_CHUNK_BYTES, 1)
    const chunk1Left = Buffer.alloc(64, 7)
    const chunk1Right = Buffer.alloc(64, 7)
    chunk1Right[7] = 9
    const harness = makeHarness(
      {
        'big-left.bin': Buffer.alloc(BINARY_CHUNK_BYTES + 64, 1),
        'big-right.bin': Buffer.alloc(BINARY_CHUNK_BYTES + 64, 1)
      },
      {
        readChunks: (path) =>
          path === 'big-left.bin' ? [chunk0Left, chunk1Left] : [chunk0Right, chunk1Right]
      }
    )
    const result = await invoke<CompareFilesResult>(harness.handlers, 'compare-files', {
      left: 'big-left.bin',
      right: 'big-right.bin'
    })
    expect(result).toEqual({
      mode: 'binary',
      same: false,
      firstDiffOffset: BINARY_CHUNK_BYTES + 7,
      totalChunks: 2
    })
  })

  it('单侧超过 1MB（另一侧小文件含 NUL）→ 走二进制分支', async () => {
    const big = Buffer.alloc(TEXT_FILE_MAX_BYTES + 10, 5)
    const harness = makeHarness({ 'big.bin': big, 'small.bin': 'a\0b' })
    const result = await invoke<CompareFilesResult>(harness.handlers, 'compare-files', {
      left: 'small.bin',
      right: 'big.bin'
    })
    expect(result.mode).toBe('binary')
  })
})

describe('createDefaultDeps（生产依赖）', () => {
  it('对话框回填与取消、真实 fs stat/read/chunk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumin-td-'))
    const file = join(dir, 'a b.txt')
    writeFileSync(file, 'hello\nworld')
    try {
      const deps = createDefaultDeps()
      vi.mocked(dialog.showOpenDialogSync).mockReturnValue([file])
      expect(deps.pickFilePath()).toBe(file)
      vi.mocked(dialog.showOpenDialogSync).mockReturnValue(undefined)
      expect(deps.pickFilePath()).toBeNull()
      expect(deps.statSize(file)).toBe(11)
      expect(deps.readWholeFile(file).toString('utf8')).toBe('hello\nworld')
      expect(Buffer.concat([...deps.readChunks(file)]).toString('utf8')).toBe('hello\nworld')
      expect(() => deps.statSize(join(dir, 'missing.txt'))).toThrow()
      expect(() => deps.readWholeFile(join(dir, 'missing.txt'))).toThrow()
      expect(() => [...deps.readChunks(join(dir, 'missing.txt'))]).toThrow()
      deps.writeClipboard('统一 diff 文本')
      expect(clipboard.writeText).toHaveBeenCalledWith('统一 diff 文本')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
