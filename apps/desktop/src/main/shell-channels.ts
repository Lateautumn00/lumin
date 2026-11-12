import { app, shell } from 'electron'
import { z } from 'zod'
import { makeError } from '@lumin/shared'
import type { IpcBus } from './ipc-bus'
import type { TaskQueue } from './task-queue'
import type { SettingsService } from './services/settings'
import type { UpdateCheckResult } from './services/updater'

const settingsGetSchema = z.object({
  key: z.string().min(1),
  defaultValue: z.unknown().optional()
})

const settingsSetSchema = z.object({
  key: z.string().min(1),
  value: z.json()
})

const cancelSchema = z.object({
  taskId: z.string().min(1)
})

export interface ShellChannelDeps {
  settings: SettingsService
  queue: TaskQueue
  logDir: () => string
  updater: { check(): Promise<UpdateCheckResult>; install(): void }
}

export function registerShellChannels(bus: IpcBus, deps: ShellChannelDeps): void {
  bus.registerSync('lumin:settings:get', 'lumin', 'settings:get', async ({ payload }) => {
    const parsed = settingsGetSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '设置读取参数无效')
    const { key, defaultValue } = parsed.data
    return deps.settings.get(key, defaultValue)
  })

  bus.registerSync('lumin:settings:set', 'lumin', 'settings:set', async ({ payload }) => {
    const parsed = settingsSetSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '设置写入参数无效')
    await deps.settings.set(parsed.data.key, parsed.data.value)
  })

  bus.registerSync('lumin:app:info', 'lumin', 'app:info', () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? '',
    chromeVersion: process.versions.chrome ?? '',
    nodeVersion: process.versions.node ?? '',
    platform: process.platform,
    locale: app.getLocale()
  }))

  bus.registerSync('lumin:log:open-dir', 'lumin', 'log:open-dir', async () => {
    const error = await shell.openPath(deps.logDir())
    if (error !== '') throw makeError('INTERNAL', '打开日志目录失败', error)
  })

  bus.registerSync('lumin:task:cancel', 'lumin', 'task:cancel', ({ payload }) => {
    const parsed = cancelSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '取消参数无效')
    return deps.queue.cancel(parsed.data.taskId)
  })

  bus.registerSync('lumin:update:check', 'lumin', 'update:check', () => deps.updater.check())

  bus.registerSync('lumin:update:install', 'lumin', 'update:install', () => {
    deps.updater.install()
  })
}
