/**
 * @file node.ts 单测（假 ctx + 临时目录，不依赖 Electron）
 * @author cuilanchao
 * @date 2026-11-21
 * @description config 缺省/回填、set-output-dir 记忆、save 成功/重名递增/清洗/错误映射（spec §9）
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IpcHandler, MainPluginContext } from '@lumin/plugin-api'
import type { AtomicFs } from '@lumin/node-kit'
import type { StructuredError } from '@lumin/shared'
import { manifest } from './manifest'
import { registerMain, registerWith, type MarkdownToolDeps } from './node'

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
  return Promise.resolve(
    handlerOf(harness, action)({ toolId: 'markdown-tool', action, payload })
  )
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

describe('registerMain', () => {
  it('壳入口注册后三通道可用', async () => {
    const harness = createHarness()
    registerMain(harness.ctx)
    await expect(invoke(harness, 'config', {})).resolves.toEqual({
      outputDir: join(harness.userData, 'markdown')
    })
    expect(harness.ipc.size).toBe(3)
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
