/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-22
 * @description file-preview 的 manifest 定义，icon 'eye' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：单窗口内预览文本/Markdown/HTML/JSON/CSV/PDF/图片与 Office 文档 */
export const manifest = defineManifest({
  id: 'file-preview',
  name: '文件预览',
  description: '单窗口预览文本、Markdown、HTML、JSON、CSV、PDF、图片与 Office 文档',
  icon: 'eye',
  category: 'document',
  order: 25,
  version: '0.1.0'
})
