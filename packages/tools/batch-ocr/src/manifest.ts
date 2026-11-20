import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'batch-ocr',
  name: '图片批量识别',
  description: '批量图片 OCR：逐张识别、可编辑预览、导出单张或合并 TXT',
  icon: 'file-scan',
  category: 'image',
  order: 91,
  version: '0.1.0'
})
