import { z } from 'zod'

/** 输入图片扩展名白名单（spec §1.2：.png/.jpg/.jpeg/.webp，大小写不敏感） */
export const IMAGE_INPUT_RE = /\.(png|jpe?g|webp)$/i

/** 单张图片体积上限（20MB；主进程 stat 后判定 OCR_IMAGE_TOO_LARGE） */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** 导出文本长度上限（防御异常载荷；正常单图远低于此值） */
export const MAX_TEXT_LENGTH = 1_000_000

const imagePathSchema = z.string().min(1).regex(IMAGE_INPUT_RE, '仅支持 PNG/JPG/WebP 图片')

/** `ocr-text:recognize` 入参（spec §5） */
export const recognizePayloadSchema = z.object({
  inputPath: imagePathSchema
})

export type RecognizePayload = z.infer<typeof recognizePayloadSchema>

/** 归一化 0–1 比例坐标（同上提的 exam-split 口径） */
const ratio01 = z.number().min(0).max(1)

/** 识别出的文本行（归一化框 + 文本；渲染端按行展示统计） */
export const ocrTextLineSchema = z
  .object({
    text: z.string().min(1),
    x: ratio01,
    y: ratio01,
    width: ratio01,
    height: ratio01
  })
  .refine((line) => line.x + line.width <= 1 + 1e-9 && line.y + line.height <= 1 + 1e-9, {
    message: '文本行框超出图片'
  })

export type OcrTextLine = z.infer<typeof ocrTextLineSchema>

/** `ocr-text:recognize` done 回包（width/height = 图片像素尺寸） */
export const recognizeResultSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  lines: z.array(ocrTextLineSchema).min(1, '未识别到文字')
})

export type RecognizeResult = z.infer<typeof recognizeResultSchema>

/** `ocr-text:save-txt` 入参：目录 + 原图（主进程据此生成文件名）+ 编辑后的文本 */
export const saveTxtPayloadSchema = z.object({
  outputDir: z.string().min(1, '请选择导出目录'),
  inputPath: imagePathSchema,
  text: z.string().min(1, '文本不能为空').max(MAX_TEXT_LENGTH, '文本过长，请拆分后导出')
})

export type SaveTxtPayload = z.infer<typeof saveTxtPayloadSchema>

/** `ocr-text:save-txt` 回包：产物绝对路径 */
export const saveTxtResultSchema = z.object({
  output: z.string().min(1)
})

export type SaveTxtResult = z.infer<typeof saveTxtResultSchema>

/** `ocr-text:config` 回包：导出目录记忆（缺省 userData/ocr-text） */
export const configResultSchema = z.object({
  outputDir: z.string().min(1)
})

export type ConfigResult = z.infer<typeof configResultSchema>
