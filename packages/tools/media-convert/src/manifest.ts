/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-19
 * @description media-convert 音视频处理 manifest，icon 'film' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.media-convert.*` 对应 */
export const manifest = defineManifest({
  id: 'media-convert',
  name: '音视频处理',
  description: '音视频转码、音频互转、片段截取、提取音频与压缩（基于 ffmpeg）',
  icon: 'film',
  category: 'media',
  order: 70,
  version: '0.2.0'
})
