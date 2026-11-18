/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-18
 * @description file-renamer 批量重命名的 manifest 定义，icon 'file-pen' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.file-renamer.*` 对应 */
export const manifest = defineManifest({
  id: 'file-renamer',
  name: '批量重命名',
  description: '按规则批量重命名文件：查找替换、序号、日期、大小写与扩展名',
  icon: 'file-pen',
  order: 55,
  version: '0.1.0'
})
