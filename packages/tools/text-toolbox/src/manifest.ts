/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-25
 * @description text-toolbox 文本工具箱的 manifest 定义，icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：文本格式/编码/统计类纯 renderer 页签 + M77 并入的编辑/对比（主进程通道 editor-* / diff-*） */
export const manifest = defineManifest({
  id: 'text-toolbox',
  name: '文本工具箱',
  description:
    'JSON 格式化压缩、Base64/URL/Hex/Unicode 编解码、正则测试、批量文本处理与字数统计、摩尔斯电码、CSV/JSON 互转、汉字转拼音、文本编辑与文本对比',
  icon: 'braces',
  category: 'text',
  order: 60,
  version: '0.5.0'
})
