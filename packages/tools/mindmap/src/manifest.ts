/**
 * @file 思维导图工具清单（壳编译期插拔入口）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 声明工具 id/名称/图标/分类/顺序；壳只通过该契约识别工具（AGENTS §2）。
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：新建/编辑树形思维导图，icon 'network' 需在壳 AppSidebar iconMap 注册 */
export const manifest = defineManifest({
  id: 'mindmap',
  name: '思维导图',
  description: '新建与编辑树形思维导图，支持导图/大纲双视图、文本生成、搜索与导入导出',
  icon: 'network',
  category: 'text',
  order: 58,
  version: '0.2.0'
})
