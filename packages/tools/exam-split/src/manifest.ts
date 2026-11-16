import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'exam-split',
  name: '试卷切割',
  description: 'PDF 拆分、合并、删页、旋转与裁剪（OCR 切题敬请期待）',
  icon: 'scissors',
  order: 40,
  version: '0.1.0'
})
