import { z } from 'zod'

/** 输入文件扩展名约束（.pdf，大小写不敏感） */
export const PDF_INPUT_RE = /\.(pdf)$/

/** 页码区间语法（仅数字/逗号/连字符/空白；语义与页数校验在 parseRanges） */
export const RANGE_RE = /^[\d\s,-]+$/

const pdfPathSchema = z.string().min(1).regex(PDF_INPUT_RE, '仅支持 .pdf 文件')

/** 页码区间文本（如 `1-3,5,7-9`；空串 = 全部页，由调用方按操作语义处理） */
export const rangesSchema = z.string().regex(RANGE_RE, '页码区间仅含数字、逗号与连字符')

export const splitPayloadSchema = z.object({
  inputPath: pdfPathSchema,
  ranges: z.string().min(1, '页码区间不能为空').regex(RANGE_RE, '页码区间仅含数字、逗号与连字符')
})

export type SplitPayload = z.infer<typeof splitPayloadSchema>

/** 合并：2–100 个有序文件（spec §1） */
export const mergePayloadSchema = z.object({
  inputPaths: z.array(pdfPathSchema).min(2, '至少选择 2 个文件').max(100, '最多合并 100 个文件')
})

export type MergePayload = z.infer<typeof mergePayloadSchema>

export const deletePayloadSchema = z.object({
  inputPath: pdfPathSchema,
  ranges: z.string().min(1, '请填写要删除的页码').regex(RANGE_RE, '页码区间仅含数字、逗号与连字符')
})

export type DeletePayload = z.infer<typeof deletePayloadSchema>

export const rotatePayloadSchema = z.object({
  inputPath: pdfPathSchema,
  ranges: rangesSchema.optional(),
  degrees: z.union([z.literal(90), z.literal(180), z.literal(270)])
})

export type RotatePayload = z.infer<typeof rotatePayloadSchema>

/**
 * 裁剪框（0–1 比例，左上原点；renderer 以当前预览页为参照归一化后提交，spec §1）。
 * 宽高 > 0 且 x+width / y+height ≤ 1（不越出参照页）。
 */
export const cropBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1)
  })
  .refine((box) => box.x + box.width <= 1 && box.y + box.height <= 1, {
    message: '裁剪框超出页面范围'
  })

export const cropPayloadSchema = z.object({
  inputPath: pdfPathSchema,
  ranges: rangesSchema.optional(),
  box: cropBoxSchema
})

export type CropPayload = z.infer<typeof cropPayloadSchema>

/** 任务成功回包：产物绝对路径列表（合并/删页/旋转/裁剪恒 1 个，拆分 = 区间数） */
export const opResultSchema = z.object({
  outputPaths: z.array(z.string().min(1))
})

export type OpResult = z.infer<typeof opResultSchema>
