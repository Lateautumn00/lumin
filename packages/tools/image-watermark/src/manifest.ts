/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 图片批量水印 manifest；icon 需在壳 AppSidebar iconMap 注册（stamp → Stamp）
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：settings 命名空间 `tools.image-watermark.*` */
export const manifest = defineManifest({
  id: 'image-watermark',
  name: '图片批量水印',
  description: '批量给图片添加文字或图片水印（位置/透明度/大小/旋转/平铺）',
  icon: 'stamp',
  category: 'image',
  order: 85,
  version: '0.1.0'
})
