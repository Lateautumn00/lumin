/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-21
 * @description fs-cleaner 文件清理 manifest，icon 'folder-cog' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.fs-cleaner.*` 对应 */
export const manifest = defineManifest({
  id: 'fs-cleaner',
  name: '文件清理',
  description: '导出目录树、清理空文件夹与临时文件、批量修改文件时间（删除均移入回收站）',
  icon: 'folder-cog',
  category: 'file',
  order: 69,
  version: '0.1.0'
})
