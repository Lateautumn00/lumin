/**
 * @file manifest.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description docx2pdf 工具清单（M80 合并打印）：id 保持 docx2pdf（包/通道名不变），
 *              显示名「文档输出」，含「转为 PDF」「打印」两页签。
 */
import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'docx2pdf',
  name: '文档输出',
  description:
    'Office 批量转 PDF（LibreOffice 组件按需下载），或打印 Office / PDF / 图片（系统打印对话框）',
  icon: 'file-output',
  category: 'document',
  order: 30,
  version: '0.3.0'
})
