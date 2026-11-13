import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'unit-converter',
  name: '单位换算',
  description: '长度重量温度等 10 类单位双向换算，常用单位收藏置顶',
  icon: 'ruler',
  order: 20,
  version: '0.1.0'
})
