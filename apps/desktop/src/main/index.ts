import { app, BrowserWindow, ipcMain, Menu, nativeTheme, safeStorage, session } from 'electron'
import log from 'electron-log'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LUMIN_INVOKE_CHANNEL, TASK_EVENT_CHANNEL, UPDATE_EVENT_CHANNEL } from '@lumin/shared'
import { DEV_CSP, PROD_CSP } from './csp'
import { createIpcBus } from './ipc-bus'
import { loadTools, type ToolRegistration } from './plugin-host'
import { createTaskQueue } from './task-queue'
import { registerShellChannels } from './shell-channels'
import { createRootLogger, createToolLogger, getLogFilePath, initLog } from './services/log'
import { createSettingsService } from './services/settings'
import { createUpdaterService } from './services/updater'
import { toolMains } from './tool-mains'
import { toolManifests } from '../tool-manifests'

let mainWindow: BrowserWindow | null = null
/** 与 renderer tokens 同步：暗色 --lumin-color-bg=#0b1220 / 亮色 #f8fafc（main.css 单源） */
let windowBackgroundColor = '#f8fafc'

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: windowBackgroundColor,
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

  // 开发模式保留 DevTools / 刷新快捷键（原生菜单已移除，Q60）；生产包无此监听
  if (process.env['ELECTRON_RENDERER_URL'] !== undefined) {
    const contents = mainWindow.webContents
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const key = input.key.toLowerCase()
      if (input.key === 'F12' || (input.control && input.shift && key === 'i')) {
        event.preventDefault()
        contents.toggleDevTools()
      } else if (input.key === 'F5' || (input.control && key === 'r')) {
        event.preventDefault()
        contents.reload()
      }
    })
  }

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

  // 首帧窗口底色按持久化主题解析，杜绝深色模式下启动白闪（renderer 挂载前窗口已着色）
  const rawThemeMode = await settings.get<unknown>('shell.theme.mode', 'system')
  const darkWindow =
    rawThemeMode === 'dark' || (rawThemeMode !== 'light' && nativeTheme.shouldUseDarkColors)
  windowBackgroundColor = darkWindow ? '#0b1220' : '#f8fafc'

  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload)
    }
  }

  const queue = createTaskQueue({
    concurrency,
    onEvent: (event) => broadcast(TASK_EVENT_CHANNEL, event)
  })
  const bus = createIpcBus({ queue, logger })
  ipcMain.handle(LUMIN_INVOKE_CHANNEL, (_event, raw: unknown) => bus.dispatch(raw))

  const updater = createUpdaterService({
    onEvent: (event) => broadcast(UPDATE_EVENT_CHANNEL, event),
    logger
  })

  registerShellChannels(bus, {
    settings,
    queue,
    logDir: () => dirname(getLogFilePath()),
    updater
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
    logger,
    paths: {
      temp: app.getPath('temp'),
      userData: app.getPath('userData'),
      // 外部二进制/模型根：按「resources/binaries 是否存在」探测——打包态由
      // extraResources 保证存在；回落开发态仓库根 binaries/（fetch-binaries.mjs
      // 落盘处；__dirname = out/main）。不依赖 app.isPackaged：pnpm 的 .pnpm 目录
      // 布局与 Electron 45 的 `electron .` 语义都会让 isPackaged 误判 true，
      // updater 的 dev 判定已改用 process.defaultApp（见 services/updater.ts）。
      binaries: existsSync(join(process.resourcesPath, 'binaries'))
        ? join(process.resourcesPath, 'binaries')
        : join(__dirname, '../../../../binaries')
    },
    // 壳级加密存储：工具敏感凭证（cookie 等）经 OS keyring 加密落盘，禁止明文
    secure: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plain) => safeStorage.encryptString(plain).toString('base64'),
      decryptString: (cipher) => safeStorage.decryptString(Buffer.from(cipher, 'base64'))
    }
  })
  for (const failure of result.failed) {
    logger.error(`工具加载失败：${failure.id}`, failure.message)
  }
  logger.info(`已加载工具：${result.loaded.map((manifest) => manifest.id).join(', ')}`)

  // 移除 Electron 默认原生菜单栏（Q60）；dev 快捷键见 createWindow 内 before-input-event
  Menu.setApplicationMenu(null)
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
