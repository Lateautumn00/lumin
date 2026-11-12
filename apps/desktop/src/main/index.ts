import { app, BrowserWindow, ipcMain, session } from 'electron'
import log from 'electron-log'
import { dirname, join } from 'node:path'
import { LUMIN_INVOKE_CHANNEL, TASK_EVENT_CHANNEL } from '@lumin/shared'
import { DEV_CSP, PROD_CSP } from './csp'
import { createIpcBus } from './ipc-bus'
import { loadTools, type ToolRegistration } from './plugin-host'
import { createTaskQueue } from './task-queue'
import { registerShellChannels } from './shell-channels'
import { createRootLogger, createToolLogger, getLogFilePath, initLog } from './services/log'
import { createSettingsService } from './services/settings'
import { toolMains } from './tool-mains'
import { toolManifests } from '../tool-manifests'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 740,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl !== undefined) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function applyCsp(): void {
  const policy = app.isPackaged ? PROD_CSP : DEV_CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
}

async function bootstrap(): Promise<void> {
  initLog()
  const logger = createRootLogger()
  const settings = createSettingsService(join(app.getPath('userData'), 'settings.json'))

  const rawConcurrency = await settings.get<unknown>('shell.taskConcurrency', 2)
  const concurrency =
    typeof rawConcurrency === 'number' && Number.isFinite(rawConcurrency) && rawConcurrency >= 1
      ? Math.floor(rawConcurrency)
      : 2

  const queue = createTaskQueue({
    concurrency,
    onEvent: (event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(TASK_EVENT_CHANNEL, event)
      }
    }
  })
  const bus = createIpcBus({ queue, logger })
  ipcMain.handle(LUMIN_INVOKE_CHANNEL, (_event, raw: unknown) => bus.dispatch(raw))

  registerShellChannels(bus, {
    settings,
    queue,
    logDir: () => dirname(getLogFilePath())
  })

  const registrations: ToolRegistration[] = toolManifests.map((manifest) => ({
    manifest,
    registerMain: toolMains[manifest.id]
  }))
  const result = await loadTools(registrations, {
    bus,
    createSettings: (toolId) => ({
      get: (key, defaultValue) => settings.get(`tools.${toolId}.${key}`, defaultValue),
      set: (key, value) => settings.set(`tools.${toolId}.${key}`, value)
    }),
    createLogger: createToolLogger,
    logger
  })
  for (const failure of result.failed) {
    logger.error(`工具加载失败：${failure.id}`, failure.message)
  }
  logger.info(`已加载工具：${result.loaded.map((manifest) => manifest.id).join(', ')}`)

  applyCsp()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app
    .whenReady()
    .then(bootstrap)
    .catch((err: unknown) => {
      log.error('应用启动失败', err)
      app.exit(1)
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
