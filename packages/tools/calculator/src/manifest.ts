import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'calculator',
  name: '计算器',
  description: '科学计算器：表达式求值、阶乘、角度切换、计算历史与进制转换',
  icon: 'calculator',
  category: 'compute',
  order: 10,
  version: '0.2.0'
})
