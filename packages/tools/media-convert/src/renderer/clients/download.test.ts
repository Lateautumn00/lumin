/**
 * @file client.ts 单测（stub window.lumin bridge，断言通道名与负载透传）
 * @author cuilanchao
 * @date 2026-11-19
 * @description renderer 只经 window.lumin 白名单 bridge 调用（AGENTS §6）；本文件锁定各封装函数的通道拼写与负载透传
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearHistory,
  cookieImportBrowser,
  cookieList,
  cookieRemove,
  cookieSet,
  history,
  markPause,
  probe,
  revealPath,
  start
} from './download'

const invoke = vi.fn(async () => ({ echoed: true }))
const reveal = vi.fn(async () => undefined)

afterEach(() => {
  vi.unstubAllGlobals()
  invoke.mockClear()
  reveal.mockClear()
})

/** 注入假 bridge（node 测试环境无 window） */
function stubBridge(): void {
  vi.stubGlobal('window', { lumin: { invoke, revealPath: reveal } })
}

describe('client 通道封装（AGENTS §6 白名单 bridge）', () => {
  it('sync 通道：probe/mark-pause/history/history:clear 通道名与负载透传', async () => {
    stubBridge()
    await expect(probe({ url: 'https://example.com/v/1' })).resolves.toEqual({ echoed: true })
    await expect(markPause({ taskId: 't1' })).resolves.toEqual({ echoed: true })
    await expect(history()).resolves.toEqual({ echoed: true })
    await expect(clearHistory()).resolves.toEqual({ echoed: true })
    expect(invoke).toHaveBeenNthCalledWith(1, 'media-convert:download-probe', {
      url: 'https://example.com/v/1'
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'media-convert:download-mark-pause', { taskId: 't1' })
    expect(invoke).toHaveBeenNthCalledWith(3, 'media-convert:download-history', {})
    expect(invoke).toHaveBeenNthCalledWith(4, 'media-convert:download-history:clear', {})
  })

  it('start 长任务：通道名与负载透传', async () => {
    stubBridge()
    const payload = {
      url: 'https://example.com/v/1',
      preset: 'best',
      outputDir: 'E:\\out'
    } as const
    await expect(start(payload)).resolves.toEqual({ echoed: true })
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('media-convert:download-start', payload)
  })

  it('cookie:* 四通道：通道名与负载透传', async () => {
    stubBridge()
    await expect(cookieList()).resolves.toEqual({ echoed: true })
    await expect(cookieSet({ platform: 'douyin', raw: 'a=1' })).resolves.toEqual({ echoed: true })
    await expect(cookieRemove({ platform: 'douyin' })).resolves.toEqual({ echoed: true })
    await expect(cookieImportBrowser({ platform: 'douyin', browser: 'firefox' })).resolves.toEqual({
      echoed: true
    })
    expect(invoke).toHaveBeenNthCalledWith(1, 'media-convert:download-cookie:list', {})
    expect(invoke).toHaveBeenNthCalledWith(2, 'media-convert:download-cookie:set', {
      platform: 'douyin',
      raw: 'a=1'
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'media-convert:download-cookie:remove', {
      platform: 'douyin'
    })
    expect(invoke).toHaveBeenNthCalledWith(4, 'media-convert:download-cookie:import-browser', {
      platform: 'douyin',
      browser: 'firefox'
    })
  })

  it('revealPath 复用壳通道', async () => {
    stubBridge()
    await expect(revealPath('E:\\out\\a.mp4')).resolves.toBeUndefined()
    expect(reveal).toHaveBeenCalledOnce()
    expect(reveal).toHaveBeenCalledWith('E:\\out\\a.mp4')
  })
})
