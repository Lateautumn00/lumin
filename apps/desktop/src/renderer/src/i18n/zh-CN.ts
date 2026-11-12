const zhCN = {
  'shell.sidebar.settings': '设置',
  'shell.sidebar.about': '关于',
  'shell.status.offline': '离线优先 · 本地运行',
  'shell.settings.title': '设置',
  'shell.settings.concurrency': '任务并发数',
  'shell.settings.save': '保存',
  'shell.settings.saved': '已保存',
  'shell.settings.saveFailed': '保存失败',
  'shell.about.title': '关于',
  'shell.about.openLog': '打开日志目录',
  'shell.about.logFailed': '打开日志目录失败',
  'shell.about.checkUpdate': '检查更新',
  'shell.about.updateChecking': '正在检查更新…',
  'shell.about.updateDevMode': '开发模式不检查更新',
  'shell.about.updateLatest': '已是最新版本',
  'shell.about.updateDownloading': '正在下载',
  'shell.about.updateDownloaded': '已下载新版本，退出应用后自动安装',
  'shell.about.installNow': '安装并重启',
  'shell.about.updateFailed': '检查更新失败'
} as const

export type MessageKey = keyof typeof zhCN

export function t(key: MessageKey): string {
  return zhCN[key]
}
