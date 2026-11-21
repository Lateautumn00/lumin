/**
 * @file screen.ts 单测（注入假 deps，不触达真实屏幕）
 * @author cuilanchao
 * @date 2026-11-21
 * @description selectDisplay 选择顺序、captureDisplay 成功/尺寸放大/错误分支
 */
import { describe, expect, it, vi } from 'vitest'
import {
  captureDisplay,
  selectDisplay,
  type CaptureSourceInfo,
  type ScreenCaptureDeps,
  type ScreenDisplayInfo
} from './screen'

const PRIMARY: ScreenDisplayInfo = {
  id: 1,
  label: '主显示器',
  bounds: { width: 1920, height: 1080 },
  scaleFactor: 2
}

const SECONDARY: ScreenDisplayInfo = {
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
  return {
    display_id: displayId,
    name: `Screen ${displayId}`,
    thumbnail: thumbnail(1920, 1080, empty)
  }
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

describe('captureDisplay', () => {
  it('成功回包：dataURL / 尺寸 / 缩放 / 显示器列表', async () => {
    const result = await captureDisplay(depsOf(), undefined)
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
  })

  it('按 scaleFactor 放大请求截图尺寸（bounds × dpr）', async () => {
    const getSources = vi.fn(async () => [source('1')])
    await captureDisplay(depsOf({ getSources }), undefined)
    expect(getSources).toHaveBeenCalledWith({ width: 3840, height: 2160 })
  })

  it('指定显示器时按 id 匹配来源', async () => {
    const result = await captureDisplay(depsOf(), '2')
    expect(result.displayId).toBe('2')
    expect(result.displayName).toBe('显示器 2')
  })

  it('来源 display_id 不匹配时使用首个来源', async () => {
    const result = await captureDisplay(
      depsOf({ getSources: async () => [source('9')] }),
      undefined
    )
    expect(result.displayId).toBe('1')
    expect(result.width).toBe(1920)
  })

  it('无显示器 → 未检测到显示器', async () => {
    await expect(captureDisplay(depsOf({ getDisplays: () => [] }), undefined)).rejects.toThrow(
      '未检测到显示器'
    )
  })

  it('空缩略图 → 未获取到屏幕画面', async () => {
    await expect(
      captureDisplay(depsOf({ getSources: async () => [source('1', true)] }), undefined)
    ).rejects.toThrow('未获取到屏幕画面')
  })

  it('无任何来源 → 未获取到屏幕画面', async () => {
    await expect(captureDisplay(depsOf({ getSources: async () => [] }), undefined)).rejects.toThrow(
      '未获取到屏幕画面'
    )
  })

  it('底层异常透传', async () => {
    const deps = depsOf({
      getSources: async () => {
        throw new Error('capturer unavailable')
      }
    })
    await expect(captureDisplay(deps, undefined)).rejects.toThrow('capturer unavailable')
  })

  it('极小显示器尺寸夹紧为 1px', async () => {
    const getSources = vi.fn(async () => [source('1')])
    await captureDisplay(
      depsOf({
        getDisplays: () => [
          { id: 1, label: '主显示器', bounds: { width: 0, height: 0 }, scaleFactor: 1 }
        ],
        getSources
      }),
      undefined
    )
    expect(getSources).toHaveBeenCalledWith({ width: 1, height: 1 })
  })
})
