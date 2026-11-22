/**
 * @file 工具清单（AGENTS §2.7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 颜色工具箱的 manifest 定义，icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：纯 renderer 工具，无 IPC 通道与主进程逻辑 */
export const manifest = defineManifest({
  id: 'color-toolbox',
  name: '颜色工具箱',
  description: 'HEX/RGB/HSL 互转、色阶与配色方案、色觉缺陷模拟、WCAG 对比度检测、吸管取色与图片调色板',
  icon: 'palette',
  category: 'misc',
  order: 80,
  version: '0.2.0'
})
