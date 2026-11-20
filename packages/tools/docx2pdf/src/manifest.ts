/**
 * @file manifest.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description docx2pdf 工具清单：id 保持 docx2pdf（包/通道名不变），显示名随离线格式扩展为 Office 转 PDF。
 */
import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'docx2pdf',
  name: 'Office 转 PDF',
  description: '将 .doc/.docx/.xls/.xlsx/.ppt/.pptx 批量转换为 PDF（LibreOffice 转换组件按需下载）',
  icon: 'file-output',
  category: 'document',
  order: 30,
  version: '0.2.0'
})
