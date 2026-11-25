/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-25
 * @description file-scanner 文件扫描工具箱 manifest（M71 三页签 + M75 并入重命名/清理/磁盘分析，共六页签），
 *              icon 'scan-search' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.file-scanner.*` 对应（子页签 `rename.*` / `clean.*` / `disk.*`） */
export const manifest = defineManifest({
  id: 'file-scanner',
  name: '文件扫描',
  description: '哈希校验、重复文件、目录对比、批量重命名、文件清理与磁盘分析，离线本地执行',
  icon: 'scan-search',
  category: 'file',
  order: 60,
  version: '0.2.0'
})
