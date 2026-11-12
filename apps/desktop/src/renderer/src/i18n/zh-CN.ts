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
  'shell.about.logFailed': '打开日志目录失败'
} as const

export type MessageKey = keyof typeof zhCN

export function t(key: MessageKey): string {
  return zhCN[key]
}
