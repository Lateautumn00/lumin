/**
 * @file node.ts 单测（假 ctx + 临时目录，不依赖 Electron）
 * @author cuilanchao
 * @date 2026-11-24
 * @description config 缺省/回填、set-output-dir 记忆、save 成功/重名递增/清洗/错误映射，
 *              open-file / save-file 的读取、体积上限、mtime 冲突与 errno 映射（spec §9）
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IpcHandler, MainPluginContext } from '@lumin/plugin-api'
import type { AtomicFs } from '@lumin/node-kit'
import type { StructuredError } from '@lumin/shared'
import { manifest } from './manifest'
import { registerMain, registerWith, type FileStat, type MarkdownToolDeps } from './node'
import { MAX_MD_FILE_BYTES } from './schema'

interface Harness {
  root: string
  userData: string
  ctx: MainPluginContext
  ipc: Map<string, IpcHandler<unknown, unknown>>
  settings: Map<string, unknown>
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * 构造假主进程上下文并注册通道
 * @param deps 可注入依赖
 */
function createHarness(deps?: MarkdownToolDeps): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-md-test-'))
  roots.push(root)
  const userData = join(root, 'userData')
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const ctx = {
    toolId: 'markdown-tool',
    manifest,
    registerIpc: (action: string, handler: IpcHandler<unknown, unknown>) => {
      ipc.set(action, handler)
    },
    registerTask: () => {
      throw new Error('markdown-tool 不应注册长任务')
    },
    settings: {
      get: async <T>(key: string, defaultValue: T): Promise<T> =>
        settings.has(key) ? (settings.get(key) as T) : defaultValue,
      set: async <T>(key: string, value: T): Promise<void> => {
        settings.set(key, value)
      }
    },
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    paths: { temp: root, userData, binaries: root }
  }
  registerWith(ctx as unknown as MainPluginContext, deps)
  return { root, userData, ctx: ctx as unknown as MainPluginContext, ipc, settings }
}

/**
 * 取已注册通道的 handler
 * @param harness 测试上下文
 * @param action 通道动作名
 */
function handlerOf(harness: Harness, action: string): IpcHandler<unknown, unknown> {
  const handler = harness.ipc.get(action)
  if (handler === undefined) throw new Error(`未注册通道：${action}`)
  return handler
}

/**
 * 调用一个通道
 * @param harness 测试上下文
 * @param action 通道动作名
 * @param payload 入参
 */
function invoke(harness: Harness, action: string, payload: unknown): Promise<unknown> {
  return Promise.resolve(handlerOf(harness, action)({ toolId: 'markdown-tool', action, payload }))
}

/** 断言异步抛出的结构化错误码 */
async function expectCode(promise: Promise<unknown>, code: string): Promise<StructuredError> {
  try {
    await promise
  } catch (err) {
    const structured = err as StructuredError
    expect(structured.code).toBe(code)
    return structured
  }
  throw new Error(`期望抛出 ${code}，实际成功`)
}

/**
 * 构造 stat 结果
 * @param size 字节数
 * @param mtimeMs 修改时间
 * @param isFile 是否普通文件
 */
function fileStat(size: number, mtimeMs: number, isFile = true): FileStat {
  return { size, mtimeMs, isFile: () => isFile }
}

/** 构造带 errno 的异常 */
function errnoError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

describe('registerMain', () => {
  it('壳入口注册后五通道可用', async () => {
    const harness = createHarness()
    registerMain(harness.ctx)
    await expect(invoke(harness, 'config', {})).resolves.toEqual({
      outputDir: join(harness.userData, 'markdown')
    })
    expect(harness.ipc.size).toBe(5)
  })
})

describe('config / set-output-dir', () => {
  it('未保存时回填 userData/markdown', async () => {
    const harness = createHarness()
    await expect(invoke(harness, 'config', {})).resolves.toEqual({
      outputDir: join(harness.userData, 'markdown')
    })
  })

  it('保存后 config 返回记忆目录', async () => {
    const harness = createHarness()
    await invoke(harness, 'set-output-dir', { outputDir: 'C:\\记忆目录' })
    expect(harness.settings.get('outputDir')).toBe('C:\\记忆目录')
    await expect(invoke(harness, 'config', {})).resolves.toEqual({ outputDir: 'C:\\记忆目录' })
  })

  it('空目录被 zod 拒绝', async () => {
    const harness = createHarness()
    await expectCode(invoke(harness, 'set-output-dir', { outputDir: '' }), 'INVALID_PAYLOAD')
  })
})

describe('save', () => {
  it('HTML 写盘成功（中文空格目录）并回写目录记忆', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, '输出 目录')
    const content = '<!doctype html>\n<h1>标题</h1>\n'
    const result = (await invoke(harness, 'save', {
      outputDir,
      baseName: '我的文档',
      extension: 'html',
      content
    })) as { output: string }

    expect(result.output).toBe(join(outputDir, '我的文档.html'))
    expect(readFileSync(result.output, 'utf8')).toBe(content)
    expect(harness.settings.get('outputDir')).toBe(outputDir)
  })

  it('重名自动递增 (1)/(2)', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, 'dup')
    const payload = { outputDir, baseName: 'same', extension: 'ts', content: 'x' }
    await invoke(harness, 'save', payload)
    await invoke(harness, 'save', payload)
    const third = (await invoke(harness, 'save', payload)) as { output: string }
    expect(third.output).toBe(join(outputDir, 'same(2).ts'))
  })

  it('文件名非法字符被清洗', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, 'clean')
    const result = (await invoke(harness, 'save', {
      outputDir,
      baseName: 'a/b:c*',
      extension: 'json',
      content: '{}'
    })) as { output: string }
    expect(result.output).toBe(join(outputDir, 'a_b_c_.json'))
  })

  it('payload 不合法（空文件名/未知扩展名/空内容）归 INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    const base = { outputDir: harness.root, baseName: 'x', extension: 'html', content: 'x' }
    await expectCode(invoke(harness, 'save', { ...base, baseName: '' }), 'INVALID_PAYLOAD')
    await expectCode(invoke(harness, 'save', { ...base, extension: 'md' }), 'INVALID_PAYLOAD')
    await expectCode(invoke(harness, 'save', { ...base, content: '' }), 'INVALID_PAYLOAD')
  })

  it('输出目录不可建时归 MD_SAVE_FAILED', async () => {
    const harness = createHarness()
    const blocked = join(harness.root, 'blocked')
    writeFileSync(blocked, 'not a dir')
    const error = await expectCode(
      invoke(harness, 'save', {
        outputDir: blocked,
        baseName: 'x',
        extension: 'html',
        content: 'x'
      }),
      'MD_SAVE_FAILED'
    )
    expect(error.detail).toBeTruthy()
  })

  it('rename 失败归 MD_SAVE_FAILED 并带 errno', async () => {
    const failing: AtomicFs = {
      writeFileSync: () => undefined,
      renameSync: () => {
        throw Object.assign(new Error('denied'), { code: 'EPERM' })
      },
      unlinkSync: () => undefined
    }
    const harness = createHarness({ fs: failing })
    const error = await expectCode(
      invoke(harness, 'save', {
        outputDir: harness.root,
        baseName: 'x',
        extension: 'html',
        content: 'x'
      }),
      'MD_SAVE_FAILED'
    )
    expect(error.detail).toBe('EPERM')
  })

  it('同名占用达上限归 MD_SAVE_FAILED', async () => {
    const harness = createHarness({ exists: () => true })
    const error = await expectCode(
      invoke(harness, 'save', {
        outputDir: harness.root,
        baseName: 'x',
        extension: 'yaml',
        content: 'x'
      }),
      'MD_SAVE_FAILED'
    )
    expect(error.detail).toContain('99')
  })

  it('真实写盘后文件存在', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, 'real')
    const result = (await invoke(harness, 'save', {
      outputDir,
      baseName: 'ok',
      extension: 'yaml',
      content: 'a: 1\n'
    })) as { output: string }
    expect(existsSync(result.output)).toBe(true)
  })
})

describe('open-file', () => {
  it('显式路径读取 UTF-8 文件并去掉 BOM', async () => {
    const harness = createHarness()
    const file = join(harness.root, '我的 文档.md')
    writeFileSync(file, '\uFEFF# 标题\n正文', 'utf8')

    const result = (await invoke(harness, 'open-file', { path: file })) as {
      path: string
      name: string
      content: string
      size: number
      mtimeMs: number
    }
    expect(result.path).toBe(file)
    expect(result.name).toBe('我的 文档.md')
    expect(result.content).toBe('# 标题\n正文')
    expect(result.size).toBeGreaterThan(0)
    expect(result.mtimeMs).toBeGreaterThan(0)
  })

  it('未传 path 时走系统对话框：取消返回 null，选中后读取', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'md-open-')), 'picked.md')
    writeFileSync(file, '# picked', 'utf8')

    const cancelled = createHarness({ pickMarkdownFile: () => null })
    await expect(invoke(cancelled, 'open-file', {})).resolves.toBeNull()

    const picked = createHarness({ pickMarkdownFile: () => file })
    const result = (await invoke(picked, 'open-file', {})) as { content: string }
    expect(result.content).toBe('# picked')
  })

  it('路径为空串归 INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expectCode(invoke(harness, 'open-file', { path: '' }), 'INVALID_PAYLOAD')
  })

  it('文件不存在归 MD_NOT_FOUND', async () => {
    const harness = createHarness()
    await expectCode(
      invoke(harness, 'open-file', { path: join(harness.root, 'missing.md') }),
      'MD_NOT_FOUND'
    )
  })

  it('路径是目录归 MD_READ_FAILED（detail NOT_FILE）', async () => {
    const harness = createHarness()
    const error = await expectCode(
      invoke(harness, 'open-file', { path: harness.root }),
      'MD_READ_FAILED'
    )
    expect(error.detail).toBe('NOT_FILE')
  })

  it('超过 5 MiB 归 MD_FILE_TOO_LARGE 且不再读取', async () => {
    const readFile = vi.fn(async () => Buffer.from('x'))
    const harness = createHarness({
      stat: async () => fileStat(MAX_MD_FILE_BYTES + 1, 1),
      readFile
    })
    await expectCode(invoke(harness, 'open-file', { path: 'C:\\big.md' }), 'MD_FILE_TOO_LARGE')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('读取期 errno 与结构化错误映射', async () => {
    const locked = createHarness({
      stat: async () => fileStat(1, 1),
      readFile: async () => {
        throw errnoError('EBUSY')
      }
    })
    await expectCode(invoke(locked, 'open-file', { path: 'C:\\a.md' }), 'MD_LOCKED')

    const broken = createHarness({
      stat: async () => fileStat(1, 1),
      readFile: async () => {
        throw errnoError('EIO')
      }
    })
    const error = await expectCode(
      invoke(broken, 'open-file', { path: 'C:\\a.md' }),
      'MD_READ_FAILED'
    )
    expect(error.detail).toBe('EIO')

    const structured: StructuredError = { code: 'MD_LOCKED', message: '被占用' }
    const passthrough = createHarness({
      stat: async () => fileStat(1, 1),
      readFile: async () => {
        throw structured
      }
    })
    await expect(invoke(passthrough, 'open-file', { path: 'C:\\a.md' })).rejects.toEqual(structured)
  })

  it('stat 失败同样映射 errno', async () => {
    const harness = createHarness({
      stat: async () => {
        throw errnoError('ENOENT')
      }
    })
    await expectCode(invoke(harness, 'open-file', { path: 'C:\\a.md' }), 'MD_NOT_FOUND')
  })
})

describe('save-file', () => {
  it('mtime 匹配时覆盖已有文件并返回新 mtime', async () => {
    const harness = createHarness()
    const file = join(harness.root, 'a.md')
    writeFileSync(file, 'old', 'utf8')
    const before = statSync(file).mtimeMs

    const result = (await invoke(harness, 'save-file', {
      path: file,
      content: '# new',
      expectedMtimeMs: before
    })) as { path: string; mtimeMs: number }

    expect(readFileSync(file, 'utf8')).toBe('# new')
    expect(result.path).toBe(file)
    expect(typeof result.mtimeMs).toBe('number')
  })

  it('mtime 冲突归 MD_FILE_CHANGED，force 后强制覆盖', async () => {
    const harness = createHarness()
    const file = join(harness.root, 'conflict.md')
    writeFileSync(file, 'old', 'utf8')
    const expected = statSync(file).mtimeMs + 1000

    await expectCode(
      invoke(harness, 'save-file', { path: file, content: 'new', expectedMtimeMs: expected }),
      'MD_FILE_CHANGED'
    )
    expect(readFileSync(file, 'utf8')).toBe('old')

    await invoke(harness, 'save-file', {
      path: file,
      content: 'new',
      expectedMtimeMs: expected,
      force: true
    })
    expect(readFileSync(file, 'utf8')).toBe('new')
  })

  it('省略 expectedMtimeMs 时可新建文件（另存为）', async () => {
    const harness = createHarness()
    const file = join(harness.root, '另存为.md')
    await invoke(harness, 'save-file', { path: file, content: '# 新文件' })
    expect(readFileSync(file, 'utf8')).toBe('# 新文件')
  })

  it('带 expectedMtimeMs 但文件已不存在归 MD_NOT_FOUND', async () => {
    const harness = createHarness()
    await expectCode(
      invoke(harness, 'save-file', {
        path: join(harness.root, 'gone.md'),
        content: 'x',
        expectedMtimeMs: 1
      }),
      'MD_NOT_FOUND'
    )
  })

  it('路径是目录归 MD_SAVE_FAILED（detail NOT_FILE）', async () => {
    const harness = createHarness({ stat: async () => fileStat(0, 1, false) })
    const error = await expectCode(
      invoke(harness, 'save-file', { path: 'C:\\dir', content: 'x', expectedMtimeMs: 1 }),
      'MD_SAVE_FAILED'
    )
    expect(error.detail).toBe('NOT_FILE')
  })

  it('写盘 errno 映射：EPERM→MD_LOCKED、其它→MD_SAVE_FAILED', async () => {
    const lockedFs: AtomicFs = {
      writeFileSync: () => {
        throw errnoError('EPERM')
      },
      renameSync: () => undefined,
      unlinkSync: () => undefined
    }
    const locked = createHarness({ fs: lockedFs })
    await expectCode(invoke(locked, 'save-file', { path: 'C:\\a.md', content: 'x' }), 'MD_LOCKED')

    const brokenFs: AtomicFs = {
      writeFileSync: () => {
        throw errnoError('EIO')
      },
      renameSync: () => undefined,
      unlinkSync: () => undefined
    }
    const broken = createHarness({ fs: brokenFs })
    const error = await expectCode(
      invoke(broken, 'save-file', { path: 'C:\\a.md', content: 'x' }),
      'MD_SAVE_FAILED'
    )
    expect(error.detail).toBe('EIO')
  })

  it('写盘成功后 mtime 读取失败回退当前时间', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'md-save-')), 'a.md')
    writeFileSync(file, 'old', 'utf8')
    let calls = 0
    const harness = createHarness({
      stat: async () => {
        calls += 1
        if (calls === 1) return fileStat(3, 100)
        throw errnoError('EIO')
      }
    })
    const result = (await invoke(harness, 'save-file', {
      path: file,
      content: 'new',
      expectedMtimeMs: 100
    })) as { mtimeMs: number }
    expect(result.mtimeMs).toBeGreaterThan(0)
  })

  it('payload 缺少 path 归 INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expectCode(invoke(harness, 'save-file', { content: 'x' }), 'INVALID_PAYLOAD')
  })
})
