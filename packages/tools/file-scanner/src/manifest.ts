/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-25
 * @description file-scanner 文件扫描工具箱 manifest（校验 / 重复文件 / 目录对比三页签），
 *              icon 'scan-search' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.file-scanner.*` 对应 */
export const manifest = defineManifest({
  id: 'file-scanner',
  name: '文件扫描',
  description: '批量校验文件哈希、查找重复文件、对比两个目录的差异，离线本地执行',
  icon: 'scan-search',
  category: 'file',
  order: 60,
  version: '0.1.0'
})
