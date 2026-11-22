import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'exam-split',
  name: '试卷切割',
  description: '试卷 OCR 自动切题，以及 PDF 拆页、合并、删页、旋转与裁剪',
  icon: 'scissors',
  category: 'document',
  order: 40,
  version: '0.1.0'
})
