/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-22
 * @description text-editor 的 manifest 定义，icon 'pencil-line' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：打开/编辑/保存任意文本文件（CodeMirror 6 动态加载） */
export const manifest = defineManifest({
  id: 'text-editor',
  name: '文本编辑器',
  description: '打开、编辑并保存文本文件，支持编码与换行符识别',
  icon: 'pencil-line',
  category: 'text',
  order: 55,
  version: '0.1.0'
})
