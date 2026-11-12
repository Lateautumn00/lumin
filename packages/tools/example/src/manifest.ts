import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'example',
  name: '示例工具',
  description: '验证插件链路的占位工具（ping 与三段式长任务）',
  icon: 'flask-conical',
  order: 90,
  version: '0.1.0'
})
