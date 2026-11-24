/**
 * @file manifest.ts 图片去水印工具清单
 * @author cuilanchao
 * @date 2026-11-24
 * @description icon `eraser` 需在壳 AppSidebar iconMap 注册（eraser → Eraser）
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：settings 命名空间 `tools.image-dewatermark.*` */
export const manifest = defineManifest({
  id: 'image-dewatermark',
  name: '图片去水印',
  description: '框选水印区域后用快速修复、模糊或纯色填充，原图不修改',
  icon: 'eraser',
  category: 'image',
  order: 86,
  version: '0.1.0'
})
