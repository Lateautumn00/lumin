/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-25
 * @description misc-toolbox 实用工具的 manifest 定义，icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：屏幕标尺 / 系统信息 / 剪贴板走 IPC，其余为纯 renderer（M78 并入系统信息、密码生成、剪贴板） */
export const manifest = defineManifest({
  id: 'misc-toolbox',
  name: '实用工具',
  description: 'IPv4/IPv6 子网计算器、屏幕标尺与秒表、倒计时、番茄钟、系统信息、密码生成与剪贴板历史',
  icon: 'timer',
  category: 'misc',
  order: 71,
  version: '0.4.0'
})
