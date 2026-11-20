/**
 * @file 工具清单（AGENTS §2：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-20
 * @description disk-analyzer 磁盘空间分析 manifest，icon 'hard-drive' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.disk-analyzer.*` 对应 */
export const manifest = defineManifest({
  id: 'disk-analyzer',
  name: '磁盘空间分析',
  description: '扫描目录查看各子项占用大小，按大小排序并逐级下钻（只读，不改文件）',
  icon: 'hard-drive',
  order: 66,
  version: '0.1.0'
})
