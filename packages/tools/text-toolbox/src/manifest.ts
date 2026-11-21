/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-18
 * @description text-toolbox 文本工具箱的 manifest 定义，icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：纯 renderer 工具，无 IPC 通道与主进程逻辑 */
export const manifest = defineManifest({
  id: 'text-toolbox',
  name: '文本工具箱',
  description: 'JSON 格式化压缩、Base64/URL/Hex/Unicode 编解码、正则测试、批量文本处理与字数统计',
  icon: 'braces',
  category: 'text',
  order: 60,
  version: '0.2.0'
})
