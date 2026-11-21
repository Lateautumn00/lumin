/**
 * @file IPC 入参/出参 zod schema 与扩展名归一（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-20
 * @description config/set-output-dir/process 三通道契约（spec §3）；
 *              旋转与翻转可组合，至少选一项由 refine 兜底
 */
import { z } from 'zod'
import { extensionOf as sharedExtensionOf } from '@lumin/shared'

/** 支持的输入扩展名白名单（小写；大小写不敏感匹配，spec §3） */
export const SUPPORTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff'] as const

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number]

/** 单文件体积上限（字节，spec §3：200MB） */
export const MAX_FILE_BYTES = 200 * 1024 * 1024

/** 单批文件数上限（防误拖整个目录） */
export const MAX_BATCH_FILES = 500

/**
 * 扩展名归一（小写、剥点、jpeg→jpg）；不在白名单 → null
 * @param raw 原始扩展名（可带点，任意大小写）
 */
export function normalizeExtension(raw: string): SupportedExtension | null {
  const ext = raw.replace(/^\./, '').toLowerCase()
  if (ext === 'jpeg') return 'jpg'
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as SupportedExtension)
    : null
}

/**
 * 从文件路径提取归一扩展名；无法识别 → null
 * @param filePath 磁盘绝对路径
 */
export function extensionOf(filePath: string): SupportedExtension | null {
  const raw = sharedExtensionOf(filePath)
  return raw === null ? null : normalizeExtension(raw)
}

/** 输入文件列表（zod：非空字符串，去重由调用方负责，上限 MAX_BATCH_FILES） */
export const filesSchema = z.array(z.string().min(1)).min(1).max(MAX_BATCH_FILES)

// —— 旋转/翻转参数（spec §3） ——

/** 旋转角度（顺时针；none = 不旋转） */
export const rotationSchema = z.enum(['none', '90', '180', '270'])
export type Rotation = z.infer<typeof rotationSchema>

/** 翻转方向（none = 不翻转） */
export const flipSchema = z.enum(['none', 'horizontal', 'vertical'])
export type Flip = z.infer<typeof flipSchema>

/** 操作参数：旋转与翻转可组合，至少选一项 */
export const rotateOptionsSchema = z
  .object({ rotation: rotationSchema, flip: flipSchema })
  .refine((value) => value.rotation !== 'none' || value.flip !== 'none', '请选择旋转角度或翻转方式')

export type RotateOptions = z.infer<typeof rotateOptionsSchema>

// —— process（task） ——

export const processPayloadSchema = z.object({
  files: filesSchema,
  outputDir: z.string().min(1),
  options: rotateOptionsSchema
})

export type ProcessPayload = z.infer<typeof processPayloadSchema>

/** 单张成功输出（spec §3） */
export const outputItemSchema = z.object({
  input: z.string(),
  output: z.string()
})

/** 单张失败项（批量语义：失败不中断批次） */
export const processFailureSchema = z.object({
  input: z.string(),
  code: z.string(),
  message: z.string()
})

export const processResultSchema = z.object({
  outputs: z.array(outputItemSchema),
  failures: z.array(processFailureSchema)
})

export type OutputItem = z.infer<typeof outputItemSchema>
export type ProcessFailure = z.infer<typeof processFailureSchema>
export type ProcessResult = z.infer<typeof processResultSchema>

// —— config（sync） ——

export const configResultSchema = z.object({ outputDir: z.string() })
export type ConfigResult = z.infer<typeof configResultSchema>

// —— set-output-dir（sync，输出目录记忆） ——

export const setOutputDirPayloadSchema = z.object({ outputDir: z.string().min(1) })
export type SetOutputDirPayload = z.infer<typeof setOutputDirPayloadSchema>
