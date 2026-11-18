import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateEvent } from '@lumin/shared'

const { updaterMock, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  return {
    listeners,
    updaterMock: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      logger: undefined as unknown,
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners.set(event, cb)
      }),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn()
    }
  }
})

vi.mock('electron', () => ({ app: {} }))
vi.mock('electron-updater', () => ({ autoUpdater: updaterMock }))

import { createUpdaterService } from './updater'

function fire(event: string, ...args: unknown[]): void {
  const listener = listeners.get(event)
  if (listener === undefined) throw new Error(`未注册监听：${event}`)
  listener(...args)
}

beforeEach(() => {
  listeners.clear()
  updaterMock.on.mockClear()
  updaterMock.checkForUpdates.mockReset()
  updaterMock.logger = undefined
})

describe('createUpdaterService', () => {
  it('dev 模式：跳过检查且不发事件', async () => {
    const events: UpdateEvent[] = []
    const service = createUpdaterService({ onEvent: (event) => events.push(event), isDev: true })

    expect(await service.check()).toEqual({ checked: false, reason: 'dev-mode' })
    expect(updaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })

  it('缺省 isDev 时按 process.defaultApp 判定（Electron 45 isPackaged 不可靠）', async () => {
    const proc = process as unknown as { defaultApp?: boolean }
    const saved = proc.defaultApp
    try {
      proc.defaultApp = true
      const dev = createUpdaterService({ onEvent: () => undefined })
      expect(await dev.check()).toEqual({ checked: false, reason: 'dev-mode' })

      proc.defaultApp = undefined
      const packaged = createUpdaterService({ onEvent: () => undefined })
      updaterMock.checkForUpdates.mockResolvedValue({ updateInfo: { version: '9.9.9' } })
      expect(await packaged.check()).toEqual({ checked: true, version: '9.9.9' })
    } finally {
      proc.defaultApp = saved
    }
  })

  it('注册 6 类更新事件监听并透传为 UpdateEvent', () => {
    const events: UpdateEvent[] = []
    createUpdaterService({ onEvent: (event) => events.push(event) })

    expect(updaterMock.on).toHaveBeenCalledTimes(6)
    fire('checking-for-update')
    fire('update-available', { version: '2.0.0' })
    fire('update-not-available')
    fire('download-progress', { percent: 42.5 })
    fire('update-downloaded', { version: '2.0.0' })
    fire('error', new Error('网络失败'))

    expect(events).toEqual([
      { kind: 'checking' },
      { kind: 'available', version: '2.0.0' },
      { kind: 'not-available' },
      { kind: 'downloading', percent: 42.5 },
      { kind: 'downloaded', version: '2.0.0' },
      { kind: 'error', error: { code: 'INTERNAL', message: '网络失败' } }
    ])
  })

  it('打包模式检查成功：checked + 版本号', async () => {
    updaterMock.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.2.3' } })
    const service = createUpdaterService({ onEvent: () => undefined, isDev: false })

    expect(await service.check()).toEqual({ checked: true, version: '1.2.3' })
    expect(updaterMock.autoDownload).toBe(true)
    expect(updaterMock.autoInstallOnAppQuit).toBe(true)
  })

  it('检查抛错：check-failed（错误同时经 error 事件推送）', async () => {
    updaterMock.checkForUpdates.mockRejectedValue(new Error('offline'))
    const events: UpdateEvent[] = []
    const service = createUpdaterService({ onEvent: (event) => events.push(event), isDev: false })

    expect(await service.check()).toEqual({ checked: false, reason: 'check-failed' })
  })

  it('传入 logger 时接管 electron-updater 日志', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    createUpdaterService({ onEvent: () => undefined, logger })
    expect(updaterMock.logger).toBe(logger)
  })

  it('install：打包模式 quitAndInstall；dev 模式 no-op', () => {
    const packaged = createUpdaterService({ onEvent: () => undefined, isDev: false })
    packaged.install()
    expect(updaterMock.quitAndInstall).toHaveBeenCalledTimes(1)

    const dev = createUpdaterService({ onEvent: () => undefined, isDev: true })
    dev.install()
    expect(updaterMock.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})
