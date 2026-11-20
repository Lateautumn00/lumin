/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-20
 * @description image-rotate 图片批量旋转/翻转的 manifest 定义，icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.image-rotate.*` 对应 */
export const manifest = defineManifest({
  id: 'image-rotate',
  name: '图片旋转',
  description: '批量旋转与翻转图片（基于 ffmpeg，原图不修改）',
  icon: 'rotate-cw',
  category: 'image',
  order: 51,
  version: '0.1.0'
})
