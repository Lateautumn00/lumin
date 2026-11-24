/**
 * @file 工具清单（AGENTS §2：壳零工具知识，新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-23
 * @description 剪贴板历史（M59）：id/icon/category/order 与 docs/spec/clipboard-history.md §5 一致。
 */
import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'clipboard-history',
  name: '剪贴板历史',
  description: '自动记录本工具页打开期间复制的文本，纯本地保存',
  icon: 'clipboard-list',
  category: 'text',
  order: 65,
  version: '1.0.0'
})
