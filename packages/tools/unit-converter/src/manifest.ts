import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'unit-converter',
  name: '单位换算',
  description:
    '长度重量温度流量角度能量频率油耗等 17 类单位双向换算，像素按 DPI 换算，常用单位收藏置顶',
  icon: 'ruler',
  category: 'compute',
  order: 20,
  version: '0.3.0'
})
