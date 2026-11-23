import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IpcHandler, MainPluginContext, TaskHandler } from '@lumin/plugin-api'
import type { StructuredError } from '@lumin/shared'
import { manifest } from './manifest'
import { createNodeDeps, registerWith, type TextEditorDeps } from './node'
import { TEXT_EDITOR_MAX_BYTES } from './formats'
import type { OpenResult, SaveAsResult, SaveResult } from './schema'

interface Harness {
  ipc: Map<string, IpcHandler<unknown, unknown>>
  root: string
  deps: TextEditorDeps
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function createHarness(overrides: Partial<TextEditorDeps> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-te-test-'))
  roots.push(root)

  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const ctx: MainPluginContext = {
    toolId: manifest.id,
    manifest,
    registerIpc: <P, R>(action: string, handler: IpcHandler<P, R>): void => {
      ipc.set(action, handler as unknown as IpcHandler<unknown, unknown>)
    },
    registerTask: <P, R>(_action: string, _handler: TaskHandler<P, R>): void => {
      throw new Error('text-editor 不应注册任务')
    },
    settings: {
      get: async <T>(_key: string, defaultValue: T): Promise<T> => defaultValue,
      set: async () => undefined
    },
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    paths: {
      temp: join(root, 'temp'),
      userData: join(root, 'userData'),
      binaries: join(root, 'binaries')
    }
  }

  const deps: TextEditorDeps = { ...createNodeDeps(), ...overrides }
  registerWith(ctx, deps)
  return { ipc, root, deps }
}

async function invoke(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  const handler = harness.ipc.get(action)
  if (handler === undefined) throw new Error(`缺少 handler：${action}`)
  return handler({ toolId: manifest.id, action, payload })
}

async function captureError(promise: Promise<unknown>): Promise<StructuredError> {
  try {
    await promise
  } catch (err) {
    return err as StructuredError
  }
  throw new Error('预期抛出结构化错误，但成功返回')
}

function makeFile(root: string, name: string, data: Buffer | string): string {
  const target = join(root, name)
  writeFileSync(target, data)
  return target
}

function fsError(code: string, message = code): Error {
  return Object.assign(new Error(message), { code })
}

describe('text-editor node', () => {
  describe('open', () => {
    it('UTF-8 + LF：返回路径/名称/体积/mtime/内容/编码/EOL', async () => {
      const harness = createHarness()
      const target = makeFile(harness.root, 'a.txt', 'hello\nworld')
      const result = (await invoke(harness, 'open', { path: target })) as OpenResult
      expect(result).toEqual({
        path: target,
        name: 'a.txt',
        size: 11,
        mtimeMs: statSync(target).mtimeMs,
        content: 'hello\nworld',
        encoding: 'utf8',
        eol: 'lf',
        readOnly: false
      })
    })

    it('UTF-8 BOM：编码判定 utf8-bom 且内容不含 BOM', async () => {
      const harness = createHarness()
      const target = makeFile(
        harness.root,
        'bom.txt',
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('你好')])
      )
      const result = (await invoke(harness, 'open', { path: target })) as OpenResult
      expect(result.encoding).toBe('utf8-bom')
      expect(result.content).toBe('你好')
    })

    it('GBK：用 iconv-lite 解码', async () => {
      const harness = createHarness()
      const target = makeFile(
        harness.root,
        'gbk.txt',
        Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0d, 0x0a])
      )
      const result = (await invoke(harness, 'open', { path: target })) as OpenResult
      expect(result.encoding).toBe('gbk')
      expect(result.content).toBe('中文\r\n')
      expect(result.eol).toBe('crlf')
    })

    it('UTF-16LE/BE：NUL 字节不误判为二进制', async () => {
      const harness = createHarness()
      const le = makeFile(
        harness.root,
        'le.txt',
        Buffer.from([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65])
      )
      const be = makeFile(
        harness.root,
        'be.txt',
        Buffer.from([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87])
      )
      const leResult = (await invoke(harness, 'open', { path: le })) as OpenResult
      const beResult = (await invoke(harness, 'open', { path: be })) as OpenResult
      expect(leResult.encoding).toBe('utf16le')
      expect(leResult.content).toBe('中文')
      expect(beResult.encoding).toBe('utf16be')
      expect(beResult.content).toBe('中文')
    })

    it('独立 CR 换行返回 eol=cr', async () => {
      const harness = createHarness()
      const target = makeFile(harness.root, 'cr.txt', 'a\rb')
      const result = (await invoke(harness, 'open', { path: target })) as OpenResult
      expect(result.eol).toBe('cr')
      expect(result.content).toBe('a\rb')
    })

    it('W_OK 失败时 readOnly=true', async () => {
      const harness = createHarness({
        access: async () => {
          throw fsError('EACCES')
        }
      })
      const target = makeFile(harness.root, 'ro.txt', 'x')
      const result = (await invoke(harness, 'open', { path: target })) as OpenResult
      expect(result.readOnly).toBe(true)
    })

    it('不存在 → TE_NOT_FOUND', async () => {
      const harness = createHarness()
      const error = await captureError(
        invoke(harness, 'open', { path: join(harness.root, 'missing.txt') })
      )
      expect(error).toMatchObject({ code: 'TE_NOT_FOUND' })
    })

    it('目录 → TE_INVALID_PATH', async () => {
      const harness = createHarness()
      const dir = join(harness.root, 'dir')
      mkdirSync(dir)
      const error = await captureError(invoke(harness, 'open', { path: dir }))
      expect(error).toMatchObject({ code: 'TE_INVALID_PATH' })
    })

    it('超过 5 MiB → TE_TOO_LARGE 且 detail 为字节数', async () => {
      const size = TEXT_EDITOR_MAX_BYTES + 1
      const harness = createHarness({
        stat: async () => ({ size, mtimeMs: 1, isFile: () => true })
      })
      const error = await captureError(invoke(harness, 'open', { path: 'C:\\big.txt' }))
      expect(error).toMatchObject({ code: 'TE_TOO_LARGE', detail: String(size) })
    })

    it('NUL 字节 → TE_DECODE_FAILED', async () => {
      const harness = createHarness()
      const target = makeFile(harness.root, 'bin.dat', Buffer.from([0x41, 0x00, 0x42]))
      const error = await captureError(invoke(harness, 'open', { path: target }))
      expect(error).toMatchObject({ code: 'TE_DECODE_FAILED', detail: '包含 NUL 字节' })
    })

    it('读取被占用 → TE_LOCKED', async () => {
      const harness = createHarness({
        readFile: async () => {
          throw fsError('EBUSY')
        }
      })
      const target = makeFile(harness.root, 'busy.txt', 'x')
      const error = await captureError(invoke(harness, 'open', { path: target }))
      expect(error).toMatchObject({ code: 'TE_LOCKED', detail: 'EBUSY' })
    })

    it('读取其他错误 → TE_DECODE_FAILED', async () => {
      const harness = createHarness({
        readFile: async () => {
          throw new Error('io boom')
        }
      })
      const target = makeFile(harness.root, 'io.txt', 'x')
      const error = await captureError(invoke(harness, 'open', { path: target }))
      expect(error).toMatchObject({ code: 'TE_DECODE_FAILED', detail: 'Error: io boom' })
    })

    it('入参非法 → INVALID_PAYLOAD', async () => {
      const harness = createHarness()
      const emptyPath = await captureError(invoke(harness, 'open', { path: '' }))
      expect(emptyPath).toMatchObject({ code: 'INVALID_PAYLOAD' })
      const nullPayload = await captureError(invoke(harness, 'open', null))
      expect(nullPayload).toMatchObject({ code: 'INVALID_PAYLOAD' })
    })
  })

  describe('save', () => {
    it('默认按 UTF-8 + 目标 EOL 写盘并返回新 mtime', async () => {
      const harness = createHarness()
      const target = makeFile(harness.root, 'a.txt', 'a\nb')
      const result = (await invoke(harness, 'save', {
        path: target,
        content: 'a\nb',
        encoding: 'utf8',
        eol: 'crlf',
        expectedMtimeMs: statSync(target).mtimeMs
      })) as SaveResult
      expect(typeof result.mtimeMs).toBe('number')
      expect(readFileSync(target, 'utf8')).toBe('a\r\nb')
    })

    it('五种编码往返一致', async () => {
      const harness = createHarness()
      const cases = [
        { encoding: 'utf8', prefix: null },
        { encoding: 'utf8-bom', prefix: [0xef, 0xbb, 0xbf] },
        { encoding: 'gbk', prefix: [0xd6, 0xd0] },
        { encoding: 'utf16le', prefix: [0xff, 0xfe] },
        { encoding: 'utf16be', prefix: [0xfe, 0xff] }
      ] as const
      for (const item of cases) {
        const target = makeFile(harness.root, `enc-${item.encoding}.txt`, '')
        await invoke(harness, 'save', {
          path: target,
          content: '中文\n',
          encoding: item.encoding,
          eol: 'lf'
        })
        const bytes = readFileSync(target)
        if (item.prefix !== null) {
          expect([...bytes.subarray(0, item.prefix.length)]).toEqual([...item.prefix])
        }
        const reopened = (await invoke(harness, 'open', { path: target })) as OpenResult
        expect(reopened.encoding).toBe(item.encoding)
        expect(reopened.content).toBe('中文\n')
      }
    })

    it('mtime 冲突 → TE_FILE_CHANGED；force 覆盖成功', async () => {
      const harness = createHarness()
      const target = makeFile(harness.root, 'c.txt', 'old')
      const opened = (await invoke(harness, 'open', { path: target })) as OpenResult
      const future = new Date(Date.now() + 60_000)
      utimesSync(target, future, future)

      const conflict = await captureError(
        invoke(harness, 'save', {
          path: target,
          content: 'next',
          encoding: 'utf8',
          eol: 'lf',
          expectedMtimeMs: opened.mtimeMs
        })
      )
      expect(conflict).toMatchObject({ code: 'TE_FILE_CHANGED' })

      const forced = (await invoke(harness, 'save', {
        path: target,
        content: 'next',
        encoding: 'utf8',
        eol: 'lf',
        expectedMtimeMs: opened.mtimeMs,
        force: true
      })) as SaveResult
      expect(typeof forced.mtimeMs).toBe('number')
      expect(readFileSync(target, 'utf8')).toBe('next')
    })

    it('目标不存在 → TE_NOT_FOUND', async () => {
      const harness = createHarness()
      const error = await captureError(
        invoke(harness, 'save', {
          path: join(harness.root, 'missing.txt'),
          content: 'x',
          encoding: 'utf8',
          eol: 'lf'
        })
      )
      expect(error).toMatchObject({ code: 'TE_NOT_FOUND' })
    })

    it('目录 → TE_INVALID_PATH', async () => {
      const harness = createHarness()
      const dir = join(harness.root, 'd')
      mkdirSync(dir)
      const error = await captureError(
        invoke(harness, 'save', { path: dir, content: 'x', encoding: 'utf8', eol: 'lf' })
      )
      expect(error).toMatchObject({ code: 'TE_INVALID_PATH' })
    })

    it('stat 被占用 → TE_LOCKED', async () => {
      const harness = createHarness({
        stat: async () => {
          throw fsError('EPERM')
        }
      })
      const error = await captureError(
        invoke(harness, 'save', {
          path: 'C:\\x.txt',
          content: 'x',
          encoding: 'utf8',
          eol: 'lf'
        })
      )
      expect(error).toMatchObject({ code: 'TE_LOCKED', detail: 'EPERM' })
    })

    it('写盘失败（errno）→ TE_SAVE_FAILED', async () => {
      const harness = createHarness({
        writeAtomic: () => {
          throw fsError('EACCES')
        }
      })
      const target = makeFile(harness.root, 'w.txt', 'x')
      const error = await captureError(
        invoke(harness, 'save', { path: target, content: 'y', encoding: 'utf8', eol: 'lf' })
      )
      expect(error).toMatchObject({ code: 'TE_SAVE_FAILED', detail: 'EACCES' })
    })

    it('写盘失败（无 errno）→ detail 为 String(err)', async () => {
      const harness = createHarness({
        writeAtomic: () => {
          throw new Error('disk full')
        }
      })
      const target = makeFile(harness.root, 'w2.txt', 'x')
      const error = await captureError(
        invoke(harness, 'save', { path: target, content: 'y', encoding: 'utf8', eol: 'lf' })
      )
      expect(error).toMatchObject({ code: 'TE_SAVE_FAILED', detail: 'Error: disk full' })
    })

    it('写后 stat 失败 → TE_SAVE_FAILED', async () => {
      const base = createNodeDeps()
      let calls = 0
      const harness = createHarness({
        stat: async (path) => {
          calls += 1
          if (calls === 2) throw fsError('EIO')
          return base.stat(path)
        }
      })
      const target = makeFile(harness.root, 's.txt', 'x')
      const error = await captureError(
        invoke(harness, 'save', { path: target, content: 'y', encoding: 'utf8', eol: 'lf' })
      )
      expect(error).toMatchObject({ code: 'TE_SAVE_FAILED', detail: 'EIO' })
    })

    it('入参非法 → INVALID_PAYLOAD', async () => {
      const harness = createHarness()
      const error = await captureError(
        invoke(harness, 'save', { path: 'C:\\a.txt', content: 'x', encoding: 'utf32', eol: 'lf' })
      )
      expect(error).toMatchObject({ code: 'INVALID_PAYLOAD' })
    })
  })

  describe('save-as', () => {
    it('成功写入 dir/name 并返回路径与新 mtime', async () => {
      const harness = createHarness()
      const result = (await invoke(harness, 'save-as', {
        dir: harness.root,
        name: '新 文件.txt',
        content: 'x\ny',
        encoding: 'utf8',
        eol: 'crlf'
      })) as SaveAsResult
      const expected = join(harness.root, '新 文件.txt')
      expect(result.path).toBe(expected)
      expect(typeof result.mtimeMs).toBe('number')
      expect(readFileSync(expected, 'utf8')).toBe('x\r\ny')
    })

    it('目标已存在 → TE_FILE_EXISTS', async () => {
      const harness = createHarness()
      makeFile(harness.root, 'same.txt', 'old')
      const error = await captureError(
        invoke(harness, 'save-as', {
          dir: harness.root,
          name: 'same.txt',
          content: 'new',
          encoding: 'utf8',
          eol: 'lf'
        })
      )
      expect(error).toMatchObject({ code: 'TE_FILE_EXISTS', detail: 'same.txt' })
    })

    it('相对目录 → TE_INVALID_PATH', async () => {
      const harness = createHarness()
      const error = await captureError(
        invoke(harness, 'save-as', {
          dir: 'relative',
          name: 'a.txt',
          content: 'x',
          encoding: 'utf8',
          eol: 'lf'
        })
      )
      expect(error).toMatchObject({ code: 'TE_INVALID_PATH' })
    })

    it('非法文件名（分隔符/盘符/点开头）→ TE_INVALID_PATH', async () => {
      const harness = createHarness()
      for (const name of ['a/b.txt', 'a\\b.txt', 'a:b.txt', '.env']) {
        const error = await captureError(
          invoke(harness, 'save-as', {
            dir: harness.root,
            name,
            content: 'x',
            encoding: 'utf8',
            eol: 'lf'
          })
        )
        expect(error).toMatchObject({ code: 'TE_INVALID_PATH' })
      }
    })

    it('目录不存在 → TE_SAVE_FAILED', async () => {
      const harness = createHarness()
      const error = await captureError(
        invoke(harness, 'save-as', {
          dir: join(harness.root, 'nope'),
          name: 'a.txt',
          content: 'x',
          encoding: 'utf8',
          eol: 'lf'
        })
      )
      expect(error).toMatchObject({ code: 'TE_SAVE_FAILED' })
    })

    it('写盘异常 → TE_SAVE_FAILED', async () => {
      const harness = createHarness({
        writeAtomic: () => {
          throw fsError('ENOSPC')
        }
      })
      const error = await captureError(
        invoke(harness, 'save-as', {
          dir: harness.root,
          name: 'a.txt',
          content: 'x',
          encoding: 'utf8',
          eol: 'lf'
        })
      )
      expect(error).toMatchObject({ code: 'TE_SAVE_FAILED', detail: 'ENOSPC' })
    })

    it('入参非法（空文件名）→ INVALID_PAYLOAD', async () => {
      const harness = createHarness()
      const error = await captureError(
        invoke(harness, 'save-as', {
          dir: harness.root,
          name: '',
          content: 'x',
          encoding: 'utf8',
          eol: 'lf'
        })
      )
      expect(error).toMatchObject({ code: 'INVALID_PAYLOAD' })
    })
  })
})
