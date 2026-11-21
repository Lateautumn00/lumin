/**
 * @file schema 契约（AGENTS §6：入参/中间结果经 zod 校验后再计算）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 子网用无符号 32 位整数表示；屏幕标尺截屏通道入参与回包同样在此定义
 */
import { z } from 'zod'

/** 无符号 32 位 IPv4 地址（十进制整数形式） */
export const ipv4AddressSchema = z.number().int().min(0).max(0xffffffff)

/** 前缀长度 0–32 */
export const prefixLengthSchema = z.number().int().min(0).max(32)

/** CIDR 解析结果：地址 + 前缀 + 主机位是否非 0（已归一化网络地址） */
export const ipv4CidrSchema = z.object({
  address: ipv4AddressSchema,
  prefix: prefixLengthSchema,
  normalized: z.boolean()
})

/** 屏幕标尺截屏入参（displayId 缺省 = 当前窗口所在显示器） */
export const captureDisplayPayloadSchema = z.object({
  displayId: z.string().min(1).optional()
})

/** 显示器选项 */
export const displayOptionSchema = z.object({ id: z.string().min(1), label: z.string() }).strict()

/** 屏幕标尺截屏回包（含物理像素尺寸与缩放比，供 cm/inch 与逻辑像素换算） */
export const captureDisplayResultSchema = z.object({
  displayId: z.string().min(1),
  displayName: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scaleFactor: z.number().positive(),
  dataUrl: z.string().startsWith('data:image/png;base64,'),
  displays: z.array(displayOptionSchema).min(1)
})

export type CaptureDisplayPayload = z.infer<typeof captureDisplayPayloadSchema>
export type CaptureDisplayResult = z.infer<typeof captureDisplayResultSchema>
