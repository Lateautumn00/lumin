/**
 * @file 媒体工具箱 manifest（M73 合并 video-download / video-player 后由 media-convert 承载）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 宿主包 id 保持 media-convert（既有 settings 命名空间不变），显示名升级为「媒体工具箱」；
 *              icon 'film' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.media-convert.*` 对应（下载/播放页签为 `download.*` / `player.*`） */
export const manifest = defineManifest({
  id: 'media-convert',
  name: '媒体工具箱',
  description: '音视频转码/截取/提取音频/压缩，视频下载与本地播放（基于 ffmpeg）',
  icon: 'film',
  category: 'media',
  order: 70,
  version: '0.3.0'
})
