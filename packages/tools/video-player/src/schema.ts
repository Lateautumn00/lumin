/**
 * @file video-player IPC schema（入参经 zod 校验后才进 handler）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 信封形状归 shared，工具 schema 与类型化 client 归本包（AGENTS §6）。
 */
import { z } from 'zod'

/** resolve 入参：绝对路径（长度上限防御异常输入） */
export const resolvePayloadSchema = z.object({
  path: z.string().min(1).max(4096)
})

export type ResolvePayload = z.infer<typeof resolvePayloadSchema>

/** resolve 结果：file:// URL + 展示元信息 */
export const resolveResultSchema = z.object({
  url: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  mime: z.string().min(1)
})

export type ResolveResult = z.infer<typeof resolveResultSchema>
