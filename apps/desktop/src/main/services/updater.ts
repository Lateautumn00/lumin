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
  /** dev 运行态判定（可注入；缺省取 process.defaultApp——Electron 45 起 `electron .` 的 isPackaged 恒为 true，不可再用） */
  isDev?: boolean
}

export interface UpdaterService {
  check(): Promise<UpdateCheckResult>
  install(): void
}

export function createUpdaterService(deps: UpdaterDeps): UpdaterService {
  // dev 判定单一真相源：Electron 主进程经默认入口（electron . / Playwright e2e）加载时
  // process.defaultApp === true，打包安装后为 undefined（electron.d.ts 官方语义）
  const isDev = deps.isDev ?? process.defaultApp === true
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
      if (isDev) return { checked: false, reason: 'dev-mode' }
      try {
        const result = await autoUpdater.checkForUpdates()
        return { checked: true, version: result?.updateInfo?.version }
      } catch {
        return { checked: false, reason: 'check-failed' }
      }
    },
    install() {
      if (isDev) return
      autoUpdater.quitAndInstall(true, true)
    }
  }
}
