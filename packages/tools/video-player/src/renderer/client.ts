/**
 * @file video-player renderer 类型化 invoke 封装（renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 单通道 resolve：校验格式并返回媒体协议 URL（lumin-media://）+ 展示元信息。
 */
import type { ResolvePayload, ResolveResult } from '../schema'

/** 解析视频路径 → file:// URL（不复制、不转码） */
export function resolve(payload: ResolvePayload): Promise<ResolveResult> {
  return window.lumin.invoke('video-player:resolve', payload)
}
