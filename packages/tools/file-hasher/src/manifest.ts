/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-19
 * @description file-hasher 文件哈希校验 manifest，icon 'hash' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.file-hasher.*` 对应 */
export const manifest = defineManifest({
  id: 'file-hasher',
  name: '文件哈希校验',
  description: '批量计算 MD5 / SHA-1 / SHA-256，粘贴期望哈希即可比对文件完整性',
  icon: 'hash',
  order: 60,
  version: '0.1.0'
})
