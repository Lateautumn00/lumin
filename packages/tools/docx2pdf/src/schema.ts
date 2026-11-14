import { z } from 'zod'

/** 输入文件扩展名约束（.doc / .docx，大小写不敏感） */
export const DOC_INPUT_RE = /\.(doc|docx)$/i

export const convertPayloadSchema = z.object({
  inputPath: z.string().min(1).regex(DOC_INPUT_RE, '仅支持 .doc/.docx 文件')
})

export type ConvertPayload = z.infer<typeof convertPayloadSchema>

/** 自定义组件路径（空串 = 清空，恢复三级定位） */
export const setPathPayloadSchema = z.object({
  path: z.string()
})

export const installPayloadSchema = z.object({})

/** `docx2pdf:status` 返回（spec §2） */
export const statusResultSchema = z.object({
  source: z.enum(['custom', 'system', 'portable', 'none']),
  path: z.string().optional(),
  customInvalid: z.boolean().optional(),
  /** 当前设置的自定义路径原值（回填输入框） */
  customPath: z.string()
})

export type StatusResult = z.infer<typeof statusResultSchema>

/** `docx2pdf:convert` 返回（done result） */
export interface ConvertResult {
  outputPath: string
}
