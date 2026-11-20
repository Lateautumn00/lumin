/**
 * @file 工具清单（AGENTS §2：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-20
 * @description zip-tool 压缩包工具 manifest，icon 'archive' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.zip-tool.*` 对应 */
export const manifest = defineManifest({
  id: 'zip-tool',
  name: '压缩包工具',
  description: 'ZIP 打包与解压（保留目录结构、冲突自动重命名、路径穿越防护）',
  icon: 'archive',
  order: 68,
  version: '0.1.0'
})
