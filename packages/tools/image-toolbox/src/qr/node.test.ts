/**
 * @file node.ts 单测（假 ctx + 临时目录，不依赖 Electron）
 * @author cuilanchao
 * @date 2026-11-19
 * @description config 缺省/回填、set-output-dir 记忆、save 成功/重名递增/文件名清洗、
 *              SVG 校验、目录不可建/write 失败/同名耗尽三类错误映射（spec §9.1）
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IpcHandler, MainPluginContext } from '@lumin/plugin-api'
import type { StructuredError } from '@lumin/shared'
import { manifest } from '../manifest'
import { registerMain, registerWith, type QrCodeDeps } from './node'
import type { AtomicFs } from './save'

/** 1×1 透明 PNG（base64） */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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
function createHarness(deps?: QrCodeDeps): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-qr-test-'))
  roots.push(root)
  const userData = join(root, 'userData')
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const settings = new Map<string, unknown>()
  const ctx = {
    toolId: 'qr-code',
    manifest,
    registerIpc: (action: string, handler: IpcHandler<unknown, unknown>) => {
      ipc.set(action, handler)
    },
    registerTask: () => {
      throw new Error('qr-code 不应注册长任务')
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
  return Promise.resolve(handlerOf(harness, action)({ toolId: 'qr-code', action, payload }))
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
  it('壳入口注册后三通道可用（重复注册覆盖同名 handler）', async () => {
    const harness = createHarness()
    registerMain(harness.ctx)
    await expect(invoke(harness, 'config', {})).resolves.toEqual({
      outputDir: join(harness.userData, 'qrcodes')
    })
    expect(harness.ipc.size).toBe(3)
  })
})

describe('config / set-output-dir', () => {
  it('未保存时回填 userData/qrcodes', async () => {
    const harness = createHarness()
    await expect(invoke(harness, 'config', {})).resolves.toEqual({
      outputDir: join(harness.userData, 'qrcodes')
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
  it('PNG 写盘成功并回写输出目录记忆', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, '输出 目录')
    const result = (await invoke(harness, 'save', {
      outputDir,
      baseName: '二维码',
      format: 'png',
      data: PNG_BASE64
    })) as { output: string }

    expect(result.output).toBe(join(outputDir, '二维码.png'))
    const bytes = readFileSync(result.output)
    expect(bytes.subarray(0, 8).toString('latin1')).toBe('\x89PNG\r\n\x1a\n')
    expect(harness.settings.get('outputDir')).toBe(outputDir)
  })

  it('重名自动递增 (1)/(2)', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, 'dup')
    const payload = { outputDir, baseName: 'same', format: 'png', data: PNG_BASE64 }
    await invoke(harness, 'save', payload)
    await invoke(harness, 'save', payload)
    const third = (await invoke(harness, 'save', payload)) as { output: string }
    expect(third.output).toBe(join(outputDir, 'same(2).png'))
  })

  it('文件名非法字符被清洗', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, 'clean')
    const result = (await invoke(harness, 'save', {
      outputDir,
      baseName: 'a/b:c*',
      format: 'png',
      data: PNG_BASE64
    })) as { output: string }
    expect(result.output).toBe(join(outputDir, 'a_b_c_.png'))
  })

  it('SVG 文本写盘（含 <?xml 前缀）', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, 'svg')
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'
    const result = (await invoke(harness, 'save', {
      outputDir,
      baseName: 'vector',
      format: 'svg',
      data: svg
    })) as { output: string }
    expect(readFileSync(result.output, 'utf8')).toBe(svg)
  })

  it('非法 SVG 与空 base64 归 QR_INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, 'bad')
    await expectCode(
      invoke(harness, 'save', { outputDir, baseName: 'x', format: 'svg', data: 'plain text' }),
      'QR_INVALID_PAYLOAD'
    )
    await expectCode(
      invoke(harness, 'save', { outputDir, baseName: 'x', format: 'png', data: '!!!' }),
      'QR_INVALID_PAYLOAD'
    )
  })

  it('payload 不合法（空文件名/未知格式）归 INVALID_PAYLOAD', async () => {
    const harness = createHarness()
    await expectCode(
      invoke(harness, 'save', {
        outputDir: harness.root,
        baseName: '',
        format: 'png',
        data: 'AAAA'
      }),
      'INVALID_PAYLOAD'
    )
    await expectCode(
      invoke(harness, 'save', {
        outputDir: harness.root,
        baseName: 'x',
        format: 'jpg',
        data: 'AAAA'
      }),
      'INVALID_PAYLOAD'
    )
  })

  it('输出路径被同名文件占用时归 QR_OUTPUT_WRITE_FAILED（mkdir 失败）', async () => {
    const harness = createHarness()
    const blocked = join(harness.root, 'blocked')
    writeFileSync(blocked, 'not a dir')
    const error = await expectCode(
      invoke(harness, 'save', {
        outputDir: blocked,
        baseName: 'x',
        format: 'png',
        data: PNG_BASE64
      }),
      'QR_OUTPUT_WRITE_FAILED'
    )
    expect(error.detail).toBeTruthy()
  })

  it('rename 失败归 QR_OUTPUT_WRITE_FAILED 并带 errno', async () => {
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
        format: 'png',
        data: PNG_BASE64
      }),
      'QR_OUTPUT_WRITE_FAILED'
    )
    expect(error.detail).toBe('EPERM')
  })

  it('同名占用达上限归 QR_OUTPUT_WRITE_FAILED', async () => {
    const harness = createHarness({ exists: () => true })
    const error = await expectCode(
      invoke(harness, 'save', {
        outputDir: harness.root,
        baseName: 'x',
        format: 'png',
        data: PNG_BASE64
      }),
      'QR_OUTPUT_WRITE_FAILED'
    )
    expect(error.detail).toContain('99')
  })

  it('真实写盘后文件存在', async () => {
    const harness = createHarness()
    const outputDir = join(harness.root, 'real')
    const result = (await invoke(harness, 'save', {
      outputDir,
      baseName: 'ok',
      format: 'png',
      data: PNG_BASE64
    })) as { output: string }
    expect(existsSync(result.output)).toBe(true)
  })
})
