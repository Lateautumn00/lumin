/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-21
 * @description image-crop 批量图片裁剪 manifest，icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.image-crop.*` 对应 */
export const manifest = defineManifest({
  id: 'image-crop',
  name: '图片裁剪',
  description: '批量按比例或区域裁剪图片（基于 ffmpeg，原图不修改）',
  icon: 'crop',
  category: 'image',
  order: 52,
  version: '0.1.0'
})
