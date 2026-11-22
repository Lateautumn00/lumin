/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-21
 * @description markdown-tool 的 manifest 定义，icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：解析在 renderer，主进程仅目录记忆与原子写盘 */
export const manifest = defineManifest({
  id: 'markdown-tool',
  name: 'Markdown 工具',
  description: 'Markdown 预览与 HTML 转换、JSON 转 TypeScript 类型或 JSON Schema、YAML 格式化与互转',
  icon: 'file-code',
  category: 'document',
  order: 80,
  version: '0.2.0'
})
