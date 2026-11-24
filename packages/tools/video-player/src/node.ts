/**
 * @file video-player 主进程逻辑（resolve：校验 + lumin-media:// URL）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 仅允许浏览器原生可解格式；不转码、不复制文件。renderer 用 <video> 直接播放。
 *              URL 走壳级媒体协议（shared `toMediaUrl`）：dev 的 http origin 与 UNC 路径下
 *              Chromium 会拒绝 file:// 媒体，协议由主进程流式回源。
 */
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import { errnoCode, makeError, toMediaUrl, type StructuredError } from '@lumin/shared'
import type { ZodType } from 'zod'
import { toolError } from './errors'
import { mimeOf, UNSUPPORTED_HINT, videoExtensionOf } from './formats'
import {
  resolvePayloadSchema,
  resolveResultSchema,
  type ResolveResult
} from './schema'

/** 工具可用的外部资源（生产实现见 createNodeDeps；测试注入假件） */
export interface VideoPlayerDeps {
  stat(path: string): Promise<{ size: number; isFile(): boolean }>
  toMediaUrl(path: string): string
}

/**
 * stat 失败 → 结构化错误（不存在/被占用/其余解析失败）
 * @param err 原始异常
 */
export function classifyStatError(err: unknown): StructuredError {
  const code = errnoCode(err)
  if (code === 'ENOENT') return toolError('VP_NOT_FOUND', code)
  return toolError('VP_RESOLVE_FAILED', code || String(err))
}

/** zod 校验：失败统一 INVALID_PAYLOAD */
function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw makeError('INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '参数无效')
  }
  return parsed.data
}

/**
 * 注册 video-player 通道（可注入 deps 供测试）
 * @param ctx 主进程插件上下文（registerIpc/log）
 * @param deps 可注入依赖
 */
export function registerWith(ctx: MainPluginContext, deps: VideoPlayerDeps): void {
  ctx.registerIpc('resolve', async ({ payload }): Promise<ResolveResult> => {
    const { path } = parseOrThrow(resolvePayloadSchema, payload)
    const ext = videoExtensionOf(path)
    if (ext === null) throw toolError('VP_UNSUPPORTED_FORMAT', UNSUPPORTED_HINT)

    let info: { size: number; isFile(): boolean }
    try {
      info = await deps.stat(path)
    } catch (err) {
      throw classifyStatError(err)
    }
    if (!info.isFile()) throw toolError('VP_RESOLVE_FAILED', '不是文件')

    let url: string
    try {
      url = deps.toMediaUrl(path)
    } catch (err) {
      throw toolError('VP_RESOLVE_FAILED', errnoCode(err) || String(err))
    }

    return resolveResultSchema.parse({
      url,
      name: basename(path),
      size: info.size,
      mime: mimeOf(ext) ?? 'application/octet-stream'
    })
  })
}

/** 生产依赖：真实 fs + 媒体协议 URL */
export function createNodeDeps(): VideoPlayerDeps {
  return {
    stat: (path) => stat(path),
    toMediaUrl
  }
}

/** 壳注册入口（tool-mains 引用） */
export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
