/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 图片拼接 manifest；icon 需在壳 AppSidebar iconMap 注册（layout-grid → LayoutGrid）
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：settings 命名空间 `tools.image-stitch.*` */
export const manifest = defineManifest({
  id: 'image-stitch',
  name: '图片拼接',
  description: '多张图片拼成纵向/横向长图或网格拼图（间距/外边距/背景色可调）',
  icon: 'layout-grid',
  category: 'image',
  order: 86,
  version: '0.1.0'
})
