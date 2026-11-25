/**
 * @file manifest.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description 文件打印工具清单：id `print` 对应 IPC 通道前缀 `print:*`，图标 printer 需在壳 AppSidebar iconMap 注册。
 */
import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'print',
  name: '文件打印',
  description: '打印 Office 文档、PDF 与图片（调用系统打印对话框）',
  icon: 'printer',
  category: 'document',
  order: 72,
  version: '0.1.0'
})
