import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shell } from 'electron'
import type { IpcHandler } from '@lumin/plugin-api'
import { registerShellChannels } from './shell-channels'
import type { IpcBus } from './ipc-bus'
import type { SettingsService } from './services/settings'
import type { TaskQueue } from './task-queue'

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3', getLocale: () => 'zh-CN' },
  shell: { openPath: vi.fn(async () => '') }
}))

function createHarness(): {
  call: (channel: string, payload: unknown) => Promise<unknown>
  values: Map<string, unknown>
  cancelled: () => string
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
  registerShellChannels(bus, { settings, queue, logDir: () => 'C:\\logs' })

  return {
    call: async (channel, payload) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`未注册：${channel}`)
      return handler({ toolId: 'lumin', action: channel, payload })
    },
    values,
    cancelled: () => cancelledId
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

  it('task:cancel 透传 taskId；非法参数 → INVALID_PAYLOAD', async () => {
    const { call, cancelled } = createHarness()
    expect(await call('lumin:task:cancel', { taskId: 'abc' })).toBe(true)
    expect(cancelled()).toBe('abc')
    await expect(call('lumin:task:cancel', {})).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })
})
