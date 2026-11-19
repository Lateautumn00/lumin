import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'ocr-text',
  name: '图片文字识别',
  description: '图片 OCR：提取文字、可编辑预览、复制与导出 TXT',
  icon: 'scan-text',
  order: 90,
  version: '0.1.0'
})
