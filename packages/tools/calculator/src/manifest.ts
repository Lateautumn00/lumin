import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'calculator',
  name: '计算器',
  description: '科学计算器：表达式求值、角度切换与计算历史',
  icon: 'calculator',
  category: 'compute',
  order: 10,
  version: '0.1.0'
})
