/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-19
 * @description PDF 图片转换工具的 manifest 定义，icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.pdf-images.*` 对应 */
export const manifest = defineManifest({
  id: 'pdf-images',
  name: 'PDF 图片转换',
  description: 'PDF 逐页转图片（PNG/JPG），图片批量合成 PDF',
  icon: 'file-image',
  category: 'document',
  order: 70,
  version: '0.1.0'
})
