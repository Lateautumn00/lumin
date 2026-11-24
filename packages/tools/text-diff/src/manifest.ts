/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 文本对比的 manifest 定义，icon 需在壳 AppSidebar iconMap 注册；
 *              M62 起含文件比较两同步主进程通道（清单字段不变，plan §4.62）
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：文本比较纯 renderer，文件比较经 pick-file / compare-files 两同步通道 */
export const manifest = defineManifest({
  id: 'text-diff',
  name: '文本对比',
  description: '左右文本逐行对比：忽略空白/大小写、并排与统一视图、差异统计与统一 diff 复制',
  icon: 'file-diff',
  category: 'text',
  order: 100,
  version: '0.1.0'
})
