import { z } from 'zod'

/** 输入图片扩展名白名单（.png/.jpg/.jpeg/.webp，大小写不敏感） */
export const IMAGE_INPUT_RE = /\.(png|jpe?g|webp)$/i

/** 单批图片数量上限 */
export const MAX_BATCH_FILES = 50

/** 单张图片体积上限（20MB；主进程 stat 后判定 BO_IMAGE_TOO_LARGE） */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** 单项导出文本长度上限（防御异常载荷） */
export const MAX_TEXT_LENGTH = 1_000_000

const imagePathSchema = z.string().min(1).regex(IMAGE_INPUT_RE, '仅支持 PNG/JPG/WebP 图片')

/** `batch-ocr:recognize` 入参（1–50 张图片绝对路径，不允许重复） */
export const recognizePayloadSchema = z.object({
  inputPaths: z
    .array(imagePathSchema)
    .min(1, '请至少选择 1 张图片')
    .max(MAX_BATCH_FILES, `单次最多 ${MAX_BATCH_FILES} 张图片`)
    .refine((paths) => new Set(paths).size === paths.length, '存在重复的图片路径')
})

export type RecognizePayload = z.infer<typeof recognizePayloadSchema>

/** 结构化错误（与 shared 信封同形，worker 回包用） */
export const itemErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  detail: z.string().optional()
})

/** 单张图片识别结果：成功带文本，失败带结构化错误 */
export const batchItemResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('done'),
    inputPath: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    text: z.string().min(1)
  }),
  z.object({
    status: z.literal('failed'),
    inputPath: z.string().min(1),
    error: itemErrorSchema
  })
])

export type BatchItemResult = z.infer<typeof batchItemResultSchema>

/** `batch-ocr:recognize` done 回包：与输入同序的逐张结果 */
export const recognizeResultSchema = z.object({
  items: z.array(batchItemResultSchema).min(1)
})

export type RecognizeResult = z.infer<typeof recognizeResultSchema>

/** 导出模式：逐张 TXT / 合并为单个 TXT */
export const EXPORT_MODES = ['per-file', 'merged'] as const

export type ExportMode = (typeof EXPORT_MODES)[number]

/** 文件名只允许基名（不含路径分隔符，防目录穿越） */
const fileNameSchema = z
  .string()
  .min(1)
  .refine((name) => !name.includes('/') && !name.includes('\\'), '文件名不能包含路径分隔符')

/** `batch-ocr:export` 入参：目录 + 模式 + 待导出项（原始文件名 + 编辑后文本） */
export const exportPayloadSchema = z.object({
  outputDir: z.string().min(1, '请选择导出目录'),
  mode: z.enum(EXPORT_MODES),
  items: z
    .array(
      z.object({
        fileName: fileNameSchema,
        text: z.string().min(1, '文本不能为空').max(MAX_TEXT_LENGTH, '文本过长，请拆分后导出')
      })
    )
    .min(1, '没有可导出的内容')
    .max(MAX_BATCH_FILES, `单次最多导出 ${MAX_BATCH_FILES} 项`)
})

export type ExportPayload = z.infer<typeof exportPayloadSchema>

/** `batch-ocr:export` 回包：产物绝对路径列表 */
export const exportResultSchema = z.object({
  outputs: z.array(z.string().min(1)).min(1)
})

export type ExportResult = z.infer<typeof exportResultSchema>

/** `batch-ocr:config` 回包：导出目录记忆（缺省 userData/batch-ocr） */
export const configResultSchema = z.object({
  outputDir: z.string().min(1)
})

export type ConfigResult = z.infer<typeof configResultSchema>
