import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'ocr-text',
  name: '图片文字识别',
  description: '图片 OCR（单张/批量）：提取文字、可编辑预览、复制与导出 TXT',
  icon: 'scan-text',
  category: 'image',
  order: 90,
  version: '0.1.0'
})
