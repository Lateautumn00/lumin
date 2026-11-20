import { z } from 'zod'

/** 输入文件扩展名约束（.pdf，大小写不敏感） */
export const PDF_INPUT_RE = /\.(pdf)$/

/** 页码区间语法（仅数字/逗号/连字符/空白；语义与页数校验在 parseRanges） */
export const RANGE_RE = /^[\d\s,-]+$/

const pdfPathSchema = z.string().min(1).regex(PDF_INPUT_RE, '仅支持 .pdf 文件')

/** 页码区间文本（如 `1-3,5,7-9`；空串 = 全部页，由调用方按操作语义处理） */
export const rangesSchema = z.string().regex(RANGE_RE, '页码区间仅含数字、逗号与连字符')

/** 命名模板占位符白名单（spec §7.2） */
export const NAME_TEMPLATE_TOKENS = ['name', 'op', 'label', 'date'] as const

const NAME_TEMPLATE_FORBIDDEN_RE = /[\\/:*?"<>|]/
const NAME_TEMPLATE_BRACE_RE = /\{([^{}]*)\}/g

/**
 * 产物命名模板（选填；spec §7.2）：必须含 `{name}`，仅允许白名单占位符，
 * 禁止路径分隔符与 Windows 非法文件名字符；上限 120 字符。
 */
export const nameTemplateSchema = z
  .string()
  .trim()
  .min(1, '命名模板不能为空')
  .max(120, '命名模板最多 120 个字符')
  .refine((text) => !NAME_TEMPLATE_FORBIDDEN_RE.test(text), '命名模板不能包含 \\ / : * ? " < > |')
  .refine((text) => text.includes('{name}'), '命名模板必须包含 {name}')
  .refine(
    (text) =>
      [...text.matchAll(NAME_TEMPLATE_BRACE_RE)].every((match) =>
        NAME_TEMPLATE_TOKENS.includes((match[1] ?? '') as (typeof NAME_TEMPLATE_TOKENS)[number])
      ),
    '命名模板包含不支持的占位符'
  )

export const splitPayloadSchema = z.object({
  inputPath: pdfPathSchema,
  ranges: z.string().min(1, '页码区间不能为空').regex(RANGE_RE, '页码区间仅含数字、逗号与连字符'),
  nameTemplate: nameTemplateSchema.optional()
})

export type SplitPayload = z.infer<typeof splitPayloadSchema>

/** 合并：2–100 个有序文件（spec §1） */
export const mergePayloadSchema = z.object({
  inputPaths: z.array(pdfPathSchema).min(2, '至少选择 2 个文件').max(100, '最多合并 100 个文件'),
  nameTemplate: nameTemplateSchema.optional()
})

export type MergePayload = z.infer<typeof mergePayloadSchema>

export const deletePayloadSchema = z.object({
  inputPath: pdfPathSchema,
  ranges: z.string().min(1, '请填写要删除的页码').regex(RANGE_RE, '页码区间仅含数字、逗号与连字符'),
  nameTemplate: nameTemplateSchema.optional()
})

export type DeletePayload = z.infer<typeof deletePayloadSchema>

export const rotatePayloadSchema = z.object({
  inputPath: pdfPathSchema,
  ranges: rangesSchema.optional(),
  degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]),
  nameTemplate: nameTemplateSchema.optional()
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
  box: cropBoxSchema,
  nameTemplate: nameTemplateSchema.optional()
})

export type CropPayload = z.infer<typeof cropPayloadSchema>

/** 任务成功回包：产物绝对路径列表（合并/删页/旋转/裁剪恒 1 个，拆分 = 区间数） */
export const opResultSchema = z.object({
  outputPaths: z.array(z.string().min(1))
})

export type OpResult = z.infer<typeof opResultSchema>

/* ─── M3b OCR 切题（spec §10） ─── */

/** OCR 输入扩展名白名单（spec §10.1：.pdf/.png/.jpg/.jpeg/.webp，大小写不敏感） */
export const OCR_INPUT_RE = /\.(pdf|png|jpe?g|webp)$/i

/**
 * 页面旋转（顺时针 90° 步进，spec §10.12）：识别与导出同一变换，region 坐标无需换算。
 * 缺省 0（老载荷兼容）。
 */
export const ocrRotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270)
])

export type OcrRotation = z.infer<typeof ocrRotationSchema>

const ocrPathSchema = z.string().min(1).regex(OCR_INPUT_RE, '仅支持 .pdf 或图片文件')

/** 归一化 0–1 比例坐标（同 M3a cropBox 口径；导出时按各页实际像素换算，spec §10.4） */
const ratio01 = z.number().min(0).max(1)

/** 识别出的文本行（归一化框 + 识别文本；行内容不参与导出，仅供聚类与列表展示） */
export const ocrLineSchema = z
  .object({
    text: z.string(),
    x: ratio01,
    y: ratio01,
    width: ratio01,
    height: ratio01
  })
  .refine((line) => line.x + line.width <= 1 + 1e-9 && line.y + line.height <= 1 + 1e-9, {
    message: '文本行框超出页面'
  })

export type OcrLine = z.infer<typeof ocrLineSchema>

/**
 * 题区（spec §10.4）：`start`/`end` = 纵向边界（横向分隔线），`xStart`/`xEnd` = 列边界。
 * `xStart`/`xEnd` 缺省 = 0/1 即全宽（单栏页，2026-11-16 增补，双栏页独立聚类）。
 */
export const ocrRegionSchema = z
  .object({
    start: ratio01,
    end: ratio01,
    xStart: ratio01.optional(),
    xEnd: ratio01.optional(),
    lines: z.array(ocrLineSchema)
  })
  .refine((region) => region.start < region.end, { message: '题区上下边界无效' })
  .refine(
    (region) =>
      region.xStart === undefined || region.xEnd === undefined || region.xStart < region.xEnd,
    { message: '题区左右边界无效' }
  )

export type OcrRegion = z.infer<typeof ocrRegionSchema>

/** 识别回包的单页（width/height = 该页渲染像素，导出换算基准） */
export const ocrPageSchema = z.object({
  pageNumber: z.number().int().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  regions: z.array(ocrRegionSchema)
})

export type OcrPage = z.infer<typeof ocrPageSchema>

/** `exam-split:ocr-detect` 入参（spec §10.4） */
export const ocrDetectPayloadSchema = z.object({
  inputPath: ocrPathSchema,
  rotation: ocrRotationSchema.default(0)
})

export type OcrDetectPayload = z.infer<typeof ocrDetectPayloadSchema>

/** `exam-split:ocr-detect` done 回包 */
export const ocrDetectResultSchema = z.object({
  pages: z.array(ocrPageSchema).min(1, '至少识别一页')
})

export type OcrDetectResult = z.infer<typeof ocrDetectResultSchema>

/** `exam-split:ocr-export` 入参：最终边界（渲染端微调后提交）+ 导出选项 */
export const ocrExportPayloadSchema = z
  .object({
    inputPath: ocrPathSchema,
    rotation: ocrRotationSchema.default(0),
    startNumber: z.number().int().min(1).max(9999),
    exportPdf: z.boolean(),
    pages: z.array(ocrPageSchema).min(1, '至少需要一页边界')
  })
  .refine((payload) => payload.pages.some((page) => page.regions.length > 0), {
    message: '至少需要一个题区'
  })

export type OcrExportPayload = z.infer<typeof ocrExportPayloadSchema>
