/**
 * @file IPC schema：屏截取色通道入参与回包（AGENTS §2.5：schema 归工具包）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 入参仅可选 displayId；回包带截图 dataURL 与可选显示器列表
 */
import { z } from 'zod'

/** 取色截屏入参（displayId 缺省 = 当前窗口所在显示器） */
export const captureDisplayPayloadSchema = z.object({
  displayId: z.string().min(1).optional()
})

/** 取色截屏回包 */
export const captureDisplayResultSchema = z.object({
  displayId: z.string().min(1),
  displayName: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  dataUrl: z.string().startsWith('data:image/png;base64,'),
  displays: z
    .array(z.object({ id: z.string().min(1), label: z.string() }).strict())
    .min(1)
})

export type CaptureDisplayPayload = z.infer<typeof captureDisplayPayloadSchema>
export type CaptureDisplayResult = z.infer<typeof captureDisplayResultSchema>
