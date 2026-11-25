import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'exam-split',
  name: '试卷切割',
  description:
    '试卷 OCR 自动切题；A3 横向双页对半切；PDF 拆页与裁剪作为 OCR 前置处理（其余 PDF 操作见「PDF 工具集」）',
  icon: 'scissors',
  category: 'document',
  order: 40,
  version: '0.1.0'
})
