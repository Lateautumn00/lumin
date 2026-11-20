/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-18
 * @description video-download 短视频下载工具的 manifest 定义，icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.video-download.*` 对应 */
export const manifest = defineManifest({
  id: 'video-download',
  name: '视频下载',
  description: '通过 yt-dlp 下载视频（仅供个人学习与研究使用）',
  icon: 'download',
  category: 'media',
  order: 40,
  version: '0.1.0'
})
