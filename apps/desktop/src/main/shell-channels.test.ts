import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shell, dialog } from 'electron'
import type { IpcHandler } from '@lumin/plugin-api'
import { registerShellChannels } from './shell-channels'
import type { IpcBus } from './ipc-bus'
import type { SettingsService } from './services/settings'
import type { TaskQueue } from './task-queue'

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3', getLocale: () => 'zh-CN' },
  shell: { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:\\out'] }))
  }
}))

function createHarness(): {
  call: (channel: string, payload: unknown) => Promise<unknown>
  values: Map<string, unknown>
  cancelled: () => string
  checks: () => number
  installs: () => number
} {
  const handlers = new Map<string, IpcHandler<unknown, unknown>>()
  const bus: IpcBus = {
    registerSync: (channel, _toolId, _action, handler) => {
      handlers.set(channel, handler)
    },
    registerTask: () => undefined,
    dispatch: async () => ({ ok: true })
  }
  const values = new Map<string, unknown>()
  const settings: SettingsService = {
    get: async <T>(key: string, defaultValue: T): Promise<T> =>
      values.has(key) ? (values.get(key) as T) : defaultValue,
    set: async <T>(key: string, value: T): Promise<void> => {
      values.set(key, value)
    }
  }
  let cancelledId = ''
  const queue: TaskQueue = {
    submit: () => 't1',
    cancel: (taskId) => {
      cancelledId = taskId
      return true
    }
  }
  let checkCount = 0
  let installCount = 0
  const updater = {
    check: async () => {
      checkCount += 1
      return { checked: false, reason: 'dev-mode' } as const
    },
    install: () => {
      installCount += 1
    }
  }
  registerShellChannels(bus, { settings, queue, logDir: () => 'C:\\logs', updater })

  return {
    call: async (channel, payload) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`未注册：${channel}`)
      return handler({ toolId: 'lumin', action: channel, payload })
    },
    values,
    cancelled: () => cancelledId,
    checks: () => checkCount,
    installs: () => installCount
  }
}

beforeEach(() => {
  vi.mocked(shell.openPath).mockResolvedValue('')
})

describe('registerShellChannels', () => {
  it('settings:get/set 往返', async () => {
    const { call, values } = createHarness()
    const got = await call('lumin:settings:get', { key: 'shell.taskConcurrency', defaultValue: 2 })
    expect(got).toBe(2)
    await call('lumin:settings:set', { key: 'shell.taskConcurrency', value: 5 })
    expect(values.get('shell.taskConcurrency')).toBe(5)
    expect(
      await call('lumin:settings:get', { key: 'shell.taskConcurrency', defaultValue: 2 })
    ).toBe(5)
  })

  it('settings 参数非法 → INVALID_PAYLOAD', async () => {
    const { call } = createHarness()
    await expect(call('lumin:settings:get', { key: '' })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
    await expect(call('lumin:settings:set', { key: 'a', value: undefined })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })

  it('app:info 返回版本信息', async () => {
    const { call } = createHarness()
    const info = await call('lumin:app:info', undefined)
    expect(info).toMatchObject({
      appVersion: '1.2.3',
      electronVersion: expect.any(String),
      platform: expect.any(String),
      locale: 'zh-CN'
    })
  })

  it('log:open-dir 成功与失败分支', async () => {
    const { call } = createHarness()
    await expect(call('lumin:log:open-dir', undefined)).resolves.toBeUndefined()

    vi.mocked(shell.openPath).mockResolvedValue('拒绝访问')
    await expect(call('lumin:log:open-dir', undefined)).rejects.toMatchObject({
      code: 'INTERNAL',
      detail: '拒绝访问'
    })
  })

  it('shell:reveal 定位文件；非法参数 → INVALID_PAYLOAD', async () => {
    const { call } = createHarness()
    await expect(call('lumin:shell:reveal', { path: 'C:\\a\\b.pdf' })).resolves.toBeUndefined()
    expect(shell.showItemInFolder).toHaveBeenCalledWith('C:\\a\\b.pdf')
    await expect(call('lumin:shell:reveal', { path: '' })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
    await expect(call('lumin:shell:reveal', undefined)).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })

  it('shell:pick-directory 返回选中目录；取消 → null；非法参数 → INVALID_PAYLOAD', async () => {
    const { call } = createHarness()
    await expect(call('lumin:shell:pick-directory', { title: '选择输出目录' })).resolves.toBe(
      'C:\\out'
    )
    expect(dialog.showOpenDialog).toHaveBeenCalledWith({
      title: '选择输出目录',
      properties: ['openDirectory', 'createDirectory']
    })

    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(call('lumin:shell:pick-directory', {})).resolves.toBeNull()

    await expect(call('lumin:shell:pick-directory', { title: '' })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })

  it('task:cancel 透传 taskId；非法参数 → INVALID_PAYLOAD', async () => {
    const { call, cancelled } = createHarness()
    expect(await call('lumin:task:cancel', { taskId: 'abc' })).toBe(true)
    expect(cancelled()).toBe('abc')
    await expect(call('lumin:task:cancel', {})).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })

  it('update:check 透传 updater 结果；update:install 触发安装', async () => {
    const { call, checks, installs } = createHarness()
    expect(await call('lumin:update:check', undefined)).toEqual({
      checked: false,
      reason: 'dev-mode'
    })
    expect(checks()).toBe(1)
    expect(await call('lumin:update:install', undefined)).toBeUndefined()
    expect(installs()).toBe(1)
  })
})
