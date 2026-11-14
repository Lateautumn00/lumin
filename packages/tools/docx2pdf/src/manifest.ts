import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'docx2pdf',
  name: 'Word 转 PDF',
  description: '将 .doc/.docx 文件转换为 PDF（LibreOffice 转换组件按需下载）',
  icon: 'file-output',
  order: 30,
  version: '0.1.0'
})
