/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-21
 * @description misc-toolbox 实用工具的 manifest 定义，icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：屏幕标尺走单通道 IPC，其余为纯 renderer */
export const manifest = defineManifest({
  id: 'misc-toolbox',
  name: '实用工具',
  description: '子网/IP 计算器、屏幕标尺与秒表、倒计时、番茄钟',
  icon: 'timer',
  category: 'misc',
  order: 71,
  version: '0.2.0'
})
