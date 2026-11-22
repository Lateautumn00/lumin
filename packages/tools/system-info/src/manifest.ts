/**
 * @file 工具清单（AGENTS §2：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-22
 * @description system-info 系统信息 manifest，icon 'monitor' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：只读采集本机 CPU/内存/磁盘/网络概览 */
export const manifest = defineManifest({
  id: 'system-info',
  name: '系统信息',
  description: 'CPU、内存、磁盘、网络与操作系统概览，一键复制（只读）',
  icon: 'monitor',
  category: 'misc',
  order: 72,
  version: '0.1.0'
})
