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
  'shell.about.updateFailed': '检查更新失败',
  'shell.about.statement': '使用声明',
  'shell.about.statement.title': '使用声明',
  'shell.about.statement.body':
    '本应用仅供个人学习、研究与非商业用途的内容处理与备份。您应确保：① 仅处理您拥有合法权利或平台明确允许的内容；② 遵守相关平台服务条款与所在地法律法规；③ 不将处理结果用于商业传播、二次分发或任何侵权用途；④ 因使用本应用产生的法律责任由使用者自行承担。本应用不内置任何绕过平台技术限制的能力。'
} as const

export type MessageKey = keyof typeof zhCN

export function t(key: MessageKey): string {
  return zhCN[key]
}
