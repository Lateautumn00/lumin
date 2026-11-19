/**
 * @file schema.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description docx2pdf IPC 入参/回参 zod 契约；输入扩展名白名单与批量上限见 formats.ts。
 */
import { z } from 'zod'
import { MAX_BATCH_FILES, OFFICE_INPUT_HINT, OFFICE_INPUT_RE } from './formats'

export const convertPayloadSchema = z.object({
  inputPaths: z
    .array(z.string().min(1).regex(OFFICE_INPUT_RE, `仅支持 ${OFFICE_INPUT_HINT} 文件`))
    .min(1, '至少选择一个文件')
    .max(MAX_BATCH_FILES, `单次最多 ${MAX_BATCH_FILES} 个文件`)
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

/** 单文件转换成功项 */
export interface BatchOutput {
  inputPath: string
  outputPath: string
}

/** 单文件转换失败项（结构化错误投影） */
export interface BatchFailure {
  inputPath: string
  code: string
  message: string
  detail?: string
}

/** `docx2pdf:convert` 返回（done result）：成功与失败并行上报 */
export interface BatchConvertResult {
  outputs: BatchOutput[]
  failures: BatchFailure[]
}
