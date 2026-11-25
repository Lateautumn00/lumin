/**
 * @file IPC 入参/出参 zod schema 与内容类型契约（AGENTS §6：入参全部 zod 校验）
 * @author cuilanchao
 * @date 2026-11-19
 * @description config/set-output-dir/save 三通道 payload 与结果形状（spec §5）；
 *              生成内容与样式类型的单一来源，payload.ts 与 ToolView 共用
 */
import { z } from 'zod'

/** 文本内容上限（字符） */
export const MAX_TEXT_CHARS = 2000
/** 网址内容上限（字符） */
export const MAX_URL_CHARS = 2048
/** 识别图片体积上限（字节，spec §3.2） */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** PNG base64 上限（字符，约 6MB 原图） */
export const MAX_PNG_BASE64_CHARS = 8 * 1024 * 1024
/** SVG 文本上限（字符） */
export const MAX_SVG_CHARS = 2 * 1024 * 1024

/** 尺寸范围（px） */
export const MIN_SIZE = 128
export const MAX_SIZE = 2048
/** 边距范围（模块） */
export const MIN_MARGIN = 0
export const MAX_MARGIN = 10

/** `#RRGGBB` 颜色（大小写不敏感） */
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/
/** 网址白名单：仅 http/https 且不含空白 */
export const URL_RE = /^https?:\/\/\S+$/i

export const qrFormatSchema = z.enum(['png', 'svg'])
export type QrFormat = z.infer<typeof qrFormatSchema>

export const errorCorrectionSchema = z.enum(['L', 'M', 'Q', 'H'])
export type ErrorCorrection = z.infer<typeof errorCorrectionSchema>

/** WiFi 加密方式（nopass 时密码可省略） */
export const wifiEncryptionSchema = z.enum(['WPA', 'WEP', 'nopass'])
export type WifiEncryption = z.infer<typeof wifiEncryptionSchema>

export const wifiInputSchema = z.object({
  ssid: z.string().max(64),
  password: z.string().max(64),
  encryption: wifiEncryptionSchema,
  hidden: z.boolean()
})
export type WifiInput = z.infer<typeof wifiInputSchema>

export const vCardInputSchema = z.object({
  name: z.string().max(100),
  org: z.string().max(100).optional(),
  title: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().max(254).optional(),
  url: z.string().max(MAX_URL_CHARS).optional(),
  address: z.string().max(200).optional()
})
export type VCardInput = z.infer<typeof vCardInputSchema>

/** 生成内容 discriminated union（四种类型，spec §3.1） */
export const qrContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), value: z.string().max(MAX_TEXT_CHARS) }),
  z.object({ type: z.literal('url'), value: z.string().max(MAX_URL_CHARS) }),
  z.object({ type: z.literal('wifi'), wifi: wifiInputSchema }),
  z.object({ type: z.literal('vcard'), vcard: vCardInputSchema })
])
export type QrContent = z.infer<typeof qrContentSchema>

/** 样式参数（纠错级别/尺寸/边距/前景背景色） */
export const qrStyleSchema = z.object({
  errorCorrection: errorCorrectionSchema,
  size: z.number().int().min(MIN_SIZE).max(MAX_SIZE),
  margin: z.number().int().min(MIN_MARGIN).max(MAX_MARGIN),
  foreground: z.string().regex(COLOR_RE),
  background: z.string().regex(COLOR_RE)
})
export type QrStyle = z.infer<typeof qrStyleSchema>

// —— config（sync） ——

export const configResultSchema = z.object({ outputDir: z.string().min(1) })
export type ConfigResult = z.infer<typeof configResultSchema>

// —— set-output-dir（sync，输出目录记忆） ——

export const setOutputDirPayloadSchema = z.object({ outputDir: z.string().min(1).max(1024) })
export type SetOutputDirPayload = z.infer<typeof setOutputDirPayloadSchema>

// —— save（sync，原子写盘） ——

export const savePayloadSchema = z.object({
  outputDir: z.string().min(1).max(1024),
  baseName: z.string().min(1).max(80),
  format: qrFormatSchema,
  data: z.string().min(1).max(MAX_PNG_BASE64_CHARS)
})
export type SavePayload = z.infer<typeof savePayloadSchema>

export const saveResultSchema = z.object({ output: z.string().min(1).max(1024) })
export type SaveResult = z.infer<typeof saveResultSchema>
