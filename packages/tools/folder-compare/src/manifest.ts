/**
 * @file 工具清单（AGENTS §2：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-20
 * @description folder-compare 文件夹对比 manifest，icon 'git-compare' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.folder-compare.*` 对应 */
export const manifest = defineManifest({
  id: 'folder-compare',
  name: '文件夹对比',
  description: '按相对路径对比左右两个目录的文件（大小/修改时间），只读不修改文件',
  icon: 'git-compare',
  category: 'file',
  order: 67,
  version: '0.1.0'
})
