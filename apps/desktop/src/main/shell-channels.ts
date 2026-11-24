import { app, dialog, shell } from 'electron'
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

const revealPathSchema = z.object({
  path: z.string().min(1)
})

const pickDirectorySchema = z.object({
  title: z.string().min(1).optional()
})

const pickSaveFileSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  defaultName: z.string().min(1).max(255).optional(),
  filters: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        extensions: z.array(z.string().min(1).max(20)).min(1).max(10)
      })
    )
    .max(5)
    .optional()
})

const trashPathsSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(200)
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

  bus.registerSync('lumin:shell:reveal', 'lumin', 'shell:reveal', ({ payload }) => {
    const parsed = revealPathSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '定位路径参数无效')
    shell.showItemInFolder(parsed.data.path)
  })

  bus.registerSync(
    'lumin:shell:pick-directory',
    'lumin',
    'shell:pick-directory',
    async ({ payload }) => {
      const parsed = pickDirectorySchema.safeParse(payload)
      if (!parsed.success) throw makeError('INVALID_PAYLOAD', '目录选择参数无效')
      const result = await dialog.showOpenDialog({
        title: parsed.data.title ?? '选择文件夹',
        properties: ['openDirectory', 'createDirectory']
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  )

  bus.registerSync(
    'lumin:shell:pick-save-file',
    'lumin',
    'shell:pick-save-file',
    async ({ payload }) => {
      const parsed = pickSaveFileSchema.safeParse(payload ?? {})
      if (!parsed.success) throw makeError('INVALID_PAYLOAD', '保存文件参数无效')
      const result = await dialog.showSaveDialog({
        title: parsed.data.title ?? '保存文件',
        ...(parsed.data.defaultName === undefined ? {} : { defaultPath: parsed.data.defaultName }),
        ...(parsed.data.filters === undefined ? {} : { filters: parsed.data.filters })
      })
      return result.canceled ? null : (result.filePath ?? null)
    }
  )

  bus.registerSync('lumin:shell:trash', 'lumin', 'shell:trash', async ({ payload }) => {
    const parsed = trashPathsSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '回收站参数无效')
    const trashed: string[] = []
    const failed: { path: string; message: string }[] = []
    for (const path of parsed.data.paths) {
      try {
        await shell.trashItem(path)
        trashed.push(path)
      } catch (err) {
        failed.push({
          path,
          message: err instanceof Error ? err.message : String(err ?? '删除失败')
        })
      }
    }
    return { trashed, failed }
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
