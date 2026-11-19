/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-19
 * @description PDF 工具集 manifest；icon 需在壳 AppSidebar iconMap 注册（files → Files）
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 IPC 通道前缀 `pdf-toolkit:*` 对应 */
export const manifest = defineManifest({
  id: 'pdf-toolkit',
  name: 'PDF 工具集',
  description: 'PDF 合并、拆分、删页、旋转、重排与元数据编辑',
  icon: 'files',
  order: 75,
  version: '0.1.0'
})
