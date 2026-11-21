/**
 * @file node.ts 单测（vi.mock electron + 假 ctx，不触达真实屏幕）
 * @author cuilanchao
 * @date 2026-11-21
 * @description capture-display 成功/错误分支、入参校验、createNodeDeps 组装
 */
import { describe, expect, it, vi } from 'vitest'
import type { IpcHandler, MainPluginContext } from '@lumin/plugin-api'
import type { ScreenCaptureDeps } from '@lumin/node-kit'
import type { StructuredError } from '@lumin/shared'
import { manifest } from './manifest'
import { createNodeDeps, registerMain, registerWith } from './node'

const electronMocks = vi.hoisted(() => ({
  getAllDisplays: vi.fn(),
  getDisplayMatching: vi.fn(),
  getFocusedWindow: vi.fn(),
  getAllWindows: vi.fn(),
  getSources: vi.fn()
}))

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: electronMocks.getAllDisplays,
    getDisplayMatching: electronMocks.getDisplayMatching
  },
  BrowserWindow: {
    getFocusedWindow: electronMocks.getFocusedWindow,
    getAllWindows: electronMocks.getAllWindows
  },
  desktopCapturer: { getSources: electronMocks.getSources }
}))

/** 缩略图假件 */
function thumbnail(width = 1920, height = 1080, empty = false) {
  return {
    isEmpty: () => empty,
    getSize: () => ({ width, height }),
    toPNG: () => Buffer.from('png-bytes')
  }
}

/** 来源假件 */
function source(displayId: string, empty = false) {
  return {
    display_id: displayId,
    name: `Screen ${displayId}`,
    thumbnail: thumbnail(1920, 1080, empty)
  }
}

/** 假 deps */
function depsOf(overrides: Partial<ScreenCaptureDeps> = {}): ScreenCaptureDeps {
  return {
    getDisplays: () => [
      { id: 1, label: '主显示器', bounds: { width: 1920, height: 1080 }, scaleFactor: 2 },
      { id: 2, label: '', bounds: { width: 1280, height: 720 }, scaleFactor: 1 }
    ],
    getCurrentDisplayId: () => 1,
    getSources: async () => [source('1'), source('2')],
    ...overrides
  }
}

interface Harness {
  ipc: Map<string, IpcHandler<unknown, unknown>>
  info: ReturnType<typeof vi.fn>
}

/** 构造假主进程上下文 */
function createHarness(deps: ScreenCaptureDeps = depsOf()): Harness {
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const info = vi.fn()
  const ctx = {
    toolId: 'misc-toolbox',
    manifest,
    registerIpc: (action: string, handler: IpcHandler<unknown, unknown>) => {
      ipc.set(action, handler)
    },
    registerTask: () => {
      throw new Error('misc-toolbox 不应注册长任务')
    },
    settings: {
      get: async <T>(_key: string, defaultValue: T): Promise<T> => defaultValue,
      set: async () => undefined
    },
    log: { debug: () => undefined, info, warn: () => undefined, error: () => undefined },
    paths: { temp: 'C:\\tmp', userData: 'C:\\userData', binaries: 'C:\\bin' }
  }
  registerWith(ctx as unknown as MainPluginContext, deps)
  return { ipc, info }
}

/** 调用 capture-display */
function invoke(harness: Harness, payload: unknown): Promise<unknown> {
  const handler = harness.ipc.get('capture-display')
  if (handler === undefined) throw new Error('未注册 capture-display')
  return Promise.resolve(handler({ toolId: 'misc-toolbox', action: 'capture-display', payload }))
}

/** 断言抛出的结构化错误码/细节 */
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

describe('capture-display', () => {
  it('成功回包：包含 scaleFactor 与显示器列表', async () => {
    const harness = createHarness()
    const result = (await invoke(harness, {})) as {
      displayId: string
      displayName: string
      width: number
      height: number
      scaleFactor: number
      dataUrl: string
      displays: { id: string; label: string }[]
    }

    expect(result.displayId).toBe('1')
    expect(result.displayName).toBe('主显示器')
    expect(result.width).toBe(1920)
    expect(result.height).toBe(1080)
    expect(result.scaleFactor).toBe(2)
    expect(result.dataUrl).toBe(
      `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`
    )
    expect(result.displays).toEqual([
      { id: '1', label: '主显示器' },
      { id: '2', label: '显示器 2' }
    ])
    expect(harness.info).toHaveBeenCalledWith('misc-toolbox registered')
  })

  it('指定显示器时按 id 匹配来源', async () => {
    const result = (await invoke(createHarness(), { displayId: '2' })) as {
      displayId: string
      scaleFactor: number
    }
    expect(result.displayId).toBe('2')
    expect(result.scaleFactor).toBe(1)
  })

  it('入参非法 → MT_CAPTURE_FAILED', async () => {
    const error = await expectCode(invoke(createHarness(), { displayId: '' }), 'MT_CAPTURE_FAILED')
    expect(error.detail).toBeTruthy()
  })

  it('无显示器 → MT_CAPTURE_FAILED（未检测到显示器）', async () => {
    const harness = createHarness(depsOf({ getDisplays: () => [] }))
    const error = await expectCode(invoke(harness, {}), 'MT_CAPTURE_FAILED')
    expect(error.detail).toBe('未检测到显示器')
  })

  it('空缩略图 → MT_CAPTURE_FAILED（未获取到屏幕画面）', async () => {
    const harness = createHarness(depsOf({ getSources: async () => [source('1', true)] }))
    const error = await expectCode(invoke(harness, {}), 'MT_CAPTURE_FAILED')
    expect(error.detail).toBe('未获取到屏幕画面')
  })

  it('截图抛错 → MT_CAPTURE_FAILED 且带原始消息', async () => {
    const harness = createHarness(
      depsOf({
        getSources: async () => {
          throw new Error('capturer unavailable')
        }
      })
    )
    const error = await expectCode(invoke(harness, {}), 'MT_CAPTURE_FAILED')
    expect(error.detail).toBe('capturer unavailable')
  })

  it('createNodeDeps 组装 Electron 能力', async () => {
    electronMocks.getAllDisplays.mockReturnValue([
      { id: 7, label: '外接屏', bounds: { width: 2560, height: 1440 }, scaleFactor: 1.5 }
    ])
    electronMocks.getFocusedWindow.mockReturnValue({ getBounds: () => ({ x: 0, y: 0 }) })
    electronMocks.getDisplayMatching.mockReturnValue({ id: 7 })
    electronMocks.getSources.mockResolvedValue([source('7')])

    const deps = createNodeDeps()
    expect(deps.getDisplays()[0]).toEqual({
      id: 7,
      label: '外接屏',
      bounds: { width: 2560, height: 1440 },
      scaleFactor: 1.5
    })
    expect(deps.getCurrentDisplayId()).toBe(7)
    await deps.getSources({ width: 100, height: 100 })
    expect(electronMocks.getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 100, height: 100 }
    })

    electronMocks.getFocusedWindow.mockReturnValue(null)
    electronMocks.getAllWindows.mockReturnValue([])
    expect(deps.getCurrentDisplayId()).toBeNull()
  })

  it('registerMain 使用生产 deps 注册通道', () => {
    electronMocks.getAllDisplays.mockReturnValue([])
    const ipc = new Map<string, IpcHandler<unknown, unknown>>()
    const ctx = {
      toolId: 'misc-toolbox',
      manifest,
      registerIpc: (action: string, handler: IpcHandler<unknown, unknown>) => {
        ipc.set(action, handler)
      },
      registerTask: () => undefined,
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
      paths: { temp: 'C:\\tmp', userData: 'C:\\userData', binaries: 'C:\\bin' }
    }
    registerMain(ctx as unknown as MainPluginContext)
    expect(ipc.has('capture-display')).toBe(true)
  })
})
