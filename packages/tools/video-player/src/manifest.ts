/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-22
 * @description video-player 视频播放器 manifest，icon 'play' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.video-player.*` 对应 */
export const manifest = defineManifest({
  id: 'video-player',
  name: '视频播放器',
  description: '播放本机视频（MP4 / WebM / OGV / OGG），支持倍速与全屏',
  icon: 'play',
  category: 'media',
  order: 45,
  version: '0.1.0'
})
