/**
 * @file node.ts 单测（vi.mock electron + 假 ctx，不触达真实屏幕）
 * @author cuilanchao
 * @date 2026-11-20
 * @description selectDisplay 选择顺序、capture-display 成功/错误分支、createNodeDeps 组装
 */
import { describe, expect, it, vi } from 'vitest'
import type { IpcHandler, MainPluginContext } from '@lumin/plugin-api'
import type { StructuredError } from '@lumin/shared'
import { manifest } from './manifest'
import {
  createNodeDeps,
  registerMain,
  registerWith,
  selectDisplay,
  type CaptureSourceInfo,
  type DisplayInfo,
  type ScreenCaptureDeps
} from './node'

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

const PRIMARY: DisplayInfo = {
  id: 1,
  label: '主显示器',
  bounds: { width: 1920, height: 1080 },
  scaleFactor: 2
}

const SECONDARY: DisplayInfo = {
  id: 2,
  label: '',
  bounds: { width: 1280, height: 720 },
  scaleFactor: 1
}

/** 缩略图假件 */
function thumbnail(width = 1920, height = 1080, empty = false) {
  return {
    isEmpty: () => empty,
    getSize: () => ({ width, height }),
    toPNG: () => Buffer.from('png-bytes')
  }
}

/** 来源假件 */
function source(displayId: string, empty = false): CaptureSourceInfo {
  return { display_id: displayId, name: `Screen ${displayId}`, thumbnail: thumbnail(1920, 1080, empty) }
}

/** 假 deps */
function depsOf(overrides: Partial<ScreenCaptureDeps> = {}): ScreenCaptureDeps {
  return {
    getDisplays: () => [PRIMARY, SECONDARY],
    getCurrentDisplayId: () => 1,
    getSources: async () => [source('1'), source('2')],
    ...overrides
  }
}

interface Harness {
  ctx: MainPluginContext
  ipc: Map<string, IpcHandler<unknown, unknown>>
  info: ReturnType<typeof vi.fn>
}

/** 构造假主进程上下文 */
function createHarness(deps: ScreenCaptureDeps = depsOf()): Harness {
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const info = vi.fn()
  const ctx = {
    toolId: 'color-toolbox',
    manifest,
    registerIpc: (action: string, handler: IpcHandler<unknown, unknown>) => {
      ipc.set(action, handler)
    },
    registerTask: () => {
      throw new Error('color-toolbox 不应注册长任务')
    },
    settings: {
      get: async <T>(_key: string, defaultValue: T): Promise<T> => defaultValue,
      set: async () => undefined
    },
    log: { debug: () => undefined, info, warn: () => undefined, error: () => undefined },
    paths: { temp: 'C:\\tmp', userData: 'C:\\userData', binaries: 'C:\\bin' }
  }
  registerWith(ctx as unknown as MainPluginContext, deps)
  return { ctx: ctx as unknown as MainPluginContext, ipc, info }
}

/** 调用 capture-display */
function invoke(harness: Harness, payload: unknown): Promise<unknown> {
  const handler = harness.ipc.get('capture-display')
  if (handler === undefined) throw new Error('未注册 capture-display')
  return Promise.resolve(handler({ toolId: 'color-toolbox', action: 'capture-display', payload }))
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

describe('selectDisplay', () => {
  it('空列表返回 null', () => {
    expect(selectDisplay([], undefined, 1)).toBeNull()
  })

  it('优先请求的显示器 id', () => {
    expect(selectDisplay([PRIMARY, SECONDARY], '2', 1)?.id).toBe(2)
  })

  it('请求 id 不存在时回落到当前窗口所在显示器', () => {
    expect(selectDisplay([PRIMARY, SECONDARY], '9', 2)?.id).toBe(2)
  })

  it('当前 id 也不存在时回落到首个', () => {
    expect(selectDisplay([PRIMARY, SECONDARY], undefined, 9)?.id).toBe(1)
    expect(selectDisplay([PRIMARY, SECONDARY], undefined, null)?.id).toBe(1)
  })
})

describe('capture-display', () => {
  it('成功回包：dataURL / 尺寸 / 显示器列表', async () => {
    const harness = createHarness()
    const result = (await invoke(harness, {})) as {
      displayId: string
      displayName: string
      width: number
      height: number
      dataUrl: string
      displays: { id: string; label: string }[]
    }

    expect(result.displayId).toBe('1')
    expect(result.displayName).toBe('主显示器')
    expect(result.width).toBe(1920)
    expect(result.height).toBe(1080)
    expect(result.dataUrl).toBe(`data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`)
    expect(result.displays).toEqual([
      { id: '1', label: '主显示器' },
      { id: '2', label: '显示器 2' }
    ])
    expect(harness.info).toHaveBeenCalledWith('color-toolbox registered')
  })

  it('按 scaleFactor 放大请求截图尺寸（bounds × dpr）', async () => {
    const getSources = vi.fn(async () => [source('1')])
    const harness = createHarness(depsOf({ getSources }))
    await invoke(harness, {})
    expect(getSources).toHaveBeenCalledWith({ width: 3840, height: 2160 })
  })

  it('指定显示器时按 id 匹配来源', async () => {
    const harness = createHarness()
    const result = (await invoke(harness, { displayId: '2' })) as { displayId: string }
    expect(result.displayId).toBe('2')
  })

  it('来源 display_id 不匹配时使用首个来源', async () => {
    const harness = createHarness(depsOf({ getSources: async () => [source('9')] }))
    const result = (await invoke(harness, {})) as { displayId: string; width: number }
    expect(result.displayId).toBe('1')
    expect(result.width).toBe(1920)
  })

  it('入参非法 → CT_CAPTURE_FAILED', async () => {
    const harness = createHarness()
    const error = await expectCode(invoke(harness, { displayId: '' }), 'CT_CAPTURE_FAILED')
    expect(error.detail).toBeTruthy()
  })

  it('无显示器 → CT_CAPTURE_FAILED（未检测到显示器）', async () => {
    const harness = createHarness(depsOf({ getDisplays: () => [] }))
    const error = await expectCode(invoke(harness, {}), 'CT_CAPTURE_FAILED')
    expect(error.detail).toBe('未检测到显示器')
  })

  it('空缩略图 → CT_CAPTURE_FAILED（中文细节保留）', async () => {
    const harness = createHarness(depsOf({ getSources: async () => [source('1', true)] }))
    const error = await expectCode(invoke(harness, {}), 'CT_CAPTURE_FAILED')
    expect(error.detail).toBe('未获取到屏幕画面')
  })

  it('无任何来源 → CT_CAPTURE_FAILED', async () => {
    const harness = createHarness(depsOf({ getSources: async () => [] }))
    const error = await expectCode(invoke(harness, {}), 'CT_CAPTURE_FAILED')
    expect(error.detail).toBe('未获取到屏幕画面')
  })

  it('截图抛错 → CT_CAPTURE_FAILED 且带原始消息', async () => {
    const harness = createHarness(
      depsOf({
        getSources: async () => {
          throw new Error('capturer unavailable')
        }
      })
    )
    const error = await expectCode(invoke(harness, {}), 'CT_CAPTURE_FAILED')
    expect(error.detail).toBe('capturer unavailable')
  })

  it('极小显示器尺寸夹紧为 1px', async () => {
    const getSources = vi.fn(async () => [source('1')])
    const harness = createHarness(
      depsOf({
        getDisplays: () => [
          { id: 1, label: '主显示器', bounds: { width: 0, height: 0 }, scaleFactor: 1 }
        ],
        getSources
      })
    )
    await invoke(harness, {})
    expect(getSources).toHaveBeenCalledWith({ width: 1, height: 1 })
  })
})

describe('createNodeDeps / registerMain', () => {
  it('createNodeDeps 组装 Electron 能力', async () => {
    electronMocks.getAllDisplays.mockReturnValue([
      { id: 3, label: '屏 3', bounds: { x: 0, y: 0, width: 800, height: 600 }, scaleFactor: 1.5 }
    ])
    const bounds = { x: 0, y: 0, width: 100, height: 100 }
    electronMocks.getFocusedWindow.mockReturnValue({ getBounds: () => bounds })
    electronMocks.getDisplayMatching.mockReturnValue({ id: 3 })
    electronMocks.getSources.mockResolvedValue([source('3')])

    const deps = createNodeDeps()
    expect(deps.getDisplays()).toEqual([
      { id: 3, label: '屏 3', bounds: { width: 800, height: 600 }, scaleFactor: 1.5 }
    ])
    expect(deps.getCurrentDisplayId()).toBe(3)
    expect(electronMocks.getDisplayMatching).toHaveBeenCalledWith(bounds)
    await expect(deps.getSources({ width: 10, height: 20 })).resolves.toHaveLength(1)
    expect(electronMocks.getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 10, height: 20 }
    })
  })

  it('无焦点窗口时回落到首个窗口', () => {
    const bounds = { x: 0, y: 0, width: 10, height: 10 }
    electronMocks.getFocusedWindow.mockReturnValue(null)
    electronMocks.getAllWindows.mockReturnValue([{ getBounds: () => bounds }])
    electronMocks.getDisplayMatching.mockReturnValue({ id: 5 })
    expect(createNodeDeps().getCurrentDisplayId()).toBe(5)
  })

  it('无窗口时返回 null', () => {
    electronMocks.getFocusedWindow.mockReturnValue(null)
    electronMocks.getAllWindows.mockReturnValue([])
    expect(createNodeDeps().getCurrentDisplayId()).toBeNull()
  })

  it('registerMain 注册 capture-display 通道', () => {
    const ipc = new Map<string, IpcHandler<unknown, unknown>>()
    const ctx = {
      toolId: 'color-toolbox',
      manifest,
      registerIpc: (action: string, handler: IpcHandler<unknown, unknown>) => {
        ipc.set(action, handler)
      },
      registerTask: () => undefined,
      settings: {
        get: async <T>(_key: string, defaultValue: T): Promise<T> => defaultValue,
        set: async () => undefined
      },
      log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
      paths: { temp: '', userData: '', binaries: '' }
    }
    registerMain(ctx as unknown as MainPluginContext)
    expect([...ipc.keys()]).toEqual(['capture-display'])
  })
})
