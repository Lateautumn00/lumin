/**
 * @file 工具错误码（UPPER_SNAKE；文案见 spec/pdf-images.md §7，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-19
 * @description pdf-images 专属结构化错误：构造、重试判定与共享工具委托
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** pdf-images 错误码全集（spec §7） */
export const PDF_IMAGES_ERROR_CODES = [
  'PI_INPUT_INVALID',
  'PI_PDF_ENCRYPTED',
  'PI_PDF_CORRUPT',
  'PI_PDF_LOCKED',
  'PI_RANGE_INVALID',
  'PI_OUTPUT_DIR_INVALID',
  'PI_DPI_INVALID',
  'PI_PAGE_SIZE_INVALID',
  'PI_IMAGE_UNSUPPORTED',
  'PI_IMAGE_CORRUPT',
  'PI_ENGINE_MISSING',
  'PI_CONVERT_FAILED'
] as const

export type PdfImagesErrorCode = (typeof PDF_IMAGES_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec §7 同源） */
const MESSAGES: Record<PdfImagesErrorCode, string> = {
  PI_INPUT_INVALID: '输入文件不存在或不受支持',
  PI_PDF_ENCRYPTED: 'PDF 已加密，请先解除密码保护',
  PI_PDF_CORRUPT: 'PDF 无法解析，可能已损坏',
  PI_PDF_LOCKED: 'PDF 正被其他程序占用，请关闭后重试',
  PI_RANGE_INVALID: '页码范围不正确，请检查后重试',
  PI_OUTPUT_DIR_INVALID: '输出目录不可用或不可写',
  PI_DPI_INVALID: '分辨率参数不正确（仅支持 72 / 150 / 300）',
  PI_PAGE_SIZE_INVALID: '页面尺寸参数不正确',
  PI_IMAGE_UNSUPPORTED: '不支持的图片格式',
  PI_IMAGE_CORRUPT: '图片无法解码，可能已损坏',
  PI_ENGINE_MISSING: '图片处理引擎未就绪，请运行 fetch 脚本获取 ffmpeg',
  PI_CONVERT_FAILED: '转换失败，请检查输入后重试'
}

/** 可重试错误码（renderer 据此显示 [重试]） */
const RETRYABLE = new Set<PdfImagesErrorCode>([
  'PI_PDF_LOCKED',
  'PI_PDF_CORRUPT',
  'PI_RANGE_INVALID',
  'PI_OUTPUT_DIR_INVALID',
  'PI_DPI_INVALID',
  'PI_PAGE_SIZE_INVALID',
  'PI_IMAGE_CORRUPT',
  'PI_CONVERT_FAILED'
])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（errno / pdfjs 消息尾行等）
 */
export function toolError(code: PdfImagesErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as PdfImagesErrorCode)
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 ENOSPC），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode
