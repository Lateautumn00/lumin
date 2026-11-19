/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-19
 * @description qr-code 二维码工具的 manifest，icon 需在壳 AppSidebar iconMap 注册 `QrCode`
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.qr-code.*` 对应 */
export const manifest = defineManifest({
  id: 'qr-code',
  name: '二维码工具',
  description: '二维码生成与图片识别（PNG/SVG 导出）',
  icon: 'qr-code',
  order: 80,
  version: '0.1.0'
})
