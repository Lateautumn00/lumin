/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-19
 * @description duplicate-finder 重复文件查找 manifest，icon 'copy' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.duplicate-finder.*` 对应 */
export const manifest = defineManifest({
  id: 'duplicate-finder',
  name: '重复文件查找',
  description: '扫描目录找出内容完全相同的文件，保留一份，其余可移入回收站',
  icon: 'copy',
  order: 65,
  version: '0.1.0'
})
