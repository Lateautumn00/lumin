/**
 * @file IPC 入参/出参 zod schema 与扩展名归一（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-21
 * @description config/set-output-dir/process 三通道契约（spec §3）；
 *              比例/自由两种模式扁平入参，自由区域越界由 refine 兜底拒绝
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

// —— 裁剪参数（spec §3） ——

/** 裁剪方式：比例 / 自由区域 */
export const cropModeSchema = z.enum(['ratio', 'free'])
export type CropMode = z.infer<typeof cropModeSchema>

/** 九宫格锚点（比例模式下裁剪窗口在图片中的位置） */
export const anchorSchema = z.enum([
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right'
])
export type CropAnchor = z.infer<typeof anchorSchema>

/**
 * 裁剪参数：扁平对象，按 mode 取用对应字段（默认值便于旧调用方与部分提交）
 * - ratio：ratioW/ratioH（1–100）+ anchor
 * - free：x/y（0–99）+ width/height（1–100），百分比且必须落在图片内
 */
export const cropOptionsSchema = z
  .object({
    mode: cropModeSchema.default('ratio'),
    ratioW: z.number().int().min(1).max(100).default(1),
    ratioH: z.number().int().min(1).max(100).default(1),
    anchor: anchorSchema.default('center'),
    x: z.number().int().min(0).max(99).default(0),
    y: z.number().int().min(0).max(99).default(0),
    width: z.number().int().min(1).max(100).default(100),
    height: z.number().int().min(1).max(100).default(100)
  })
  .refine(
    (value) =>
      value.mode !== 'free' ||
      (value.x + value.width <= 100 && value.y + value.height <= 100),
    '裁剪区域超出图片范围'
  )

export type CropOptions = z.infer<typeof cropOptionsSchema>

// —— process（task） ——

export const processPayloadSchema = z.object({
  files: filesSchema,
  outputDir: z.string().min(1),
  options: cropOptionsSchema
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
