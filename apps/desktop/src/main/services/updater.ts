import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { toStructuredError, type UpdateEvent } from '@lumin/shared'

export interface UpdateCheckResult {
  checked: boolean
  reason?: 'dev-mode' | 'check-failed'
  version?: string
}

export interface UpdaterLogger {
  info(message: unknown): void
  warn(message: unknown): void
  error(message: unknown): void
}

export interface UpdaterDeps {
  onEvent: (event: UpdateEvent) => void
  logger?: UpdaterLogger
}

export interface UpdaterService {
  check(): Promise<UpdateCheckResult>
  install(): void
}

export function createUpdaterService(deps: UpdaterDeps): UpdaterService {
  if (deps.logger !== undefined) {
    autoUpdater.logger = deps.logger
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const emit = deps.onEvent
  autoUpdater.on('checking-for-update', () => {
    emit({ kind: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    emit({ kind: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    emit({ kind: 'not-available' })
  })
  autoUpdater.on('download-progress', (progress) => {
    emit({ kind: 'downloading', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    emit({ kind: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    emit({ kind: 'error', error: toStructuredError(err) })
  })

  return {
    async check() {
      if (!app.isPackaged) return { checked: false, reason: 'dev-mode' }
      try {
        const result = await autoUpdater.checkForUpdates()
        return { checked: true, version: result?.updateInfo?.version }
      } catch {
        return { checked: false, reason: 'check-failed' }
      }
    },
    install() {
      if (!app.isPackaged) return
      autoUpdater.quitAndInstall(true, true)
    }
  }
}
