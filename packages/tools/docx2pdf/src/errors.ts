import { classifyConvertFailure } from '@lumin/node-kit/office'
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** 工具错误码（UPPER_SNAKE；文案见 spec §5，改动须同步 spec） */
export const DOCX2PDF_ERROR_CODES = [
  'SOFFICE_NOT_FOUND',
  'INPUT_NOT_FOUND',
  'INPUT_LOCKED',
  'INPUT_LOAD_FAILED',
  'CONVERT_TIMEOUT',
  'OUTPUT_MISSING',
  'OUTPUT_WRITE_FAILED',
  'SPAWN_FAILED',
  'CONVERT_FAILED',
  'DOWNLOAD_FAILED',
  'CHECKSUM_MISMATCH',
  'INSTALL_FAILED'
] as const

export type Docx2pdfErrorCode = (typeof DOCX2PDF_ERROR_CODES)[number]

const MESSAGES: Record<Docx2pdfErrorCode, string> = {
  SOFFICE_NOT_FOUND: '未检测到 LibreOffice 转换组件，请下载安装或指定路径',
  INPUT_NOT_FOUND: '输入文件不存在，请重新选择',
  INPUT_LOCKED: '文件被其他程序占用，请关闭后重试',
  INPUT_LOAD_FAILED: '文件无法读取（可能已损坏或已加密）',
  CONVERT_TIMEOUT: '转换超时（60 秒），已终止',
  OUTPUT_MISSING: '转换未生成有效 PDF',
  OUTPUT_WRITE_FAILED: '磁盘无法写入，请检查剩余空间与目录权限',
  SPAWN_FAILED: '启动转换组件失败',
  CONVERT_FAILED: '转换组件异常退出，请重试或查看详情',
  DOWNLOAD_FAILED: '组件下载失败，请检查网络后重试',
  CHECKSUM_MISMATCH: '组件校验失败，已删除损坏文件，请重试',
  INSTALL_FAILED: '组件安装失败，请重试'
}

/** 可重试错误码（renderer 据此显示 [重试]；spec §6） */
const RETRYABLE = new Set<Docx2pdfErrorCode>([
  'INPUT_LOCKED',
  'CONVERT_TIMEOUT',
  'OUTPUT_MISSING',
  'OUTPUT_WRITE_FAILED',
  'CONVERT_FAILED',
  'DOWNLOAD_FAILED',
  'CHECKSUM_MISMATCH',
  'INSTALL_FAILED'
])

export function toolError(code: Docx2pdfErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as Docx2pdfErrorCode)
}

/** 通用转换失败归类 → 本工具错误码（源文件无法加载 / 其余转换失败） */
export function convertFailureCode(stderr: string): Docx2pdfErrorCode {
  return classifyConvertFailure(stderr) === 'load' ? 'INPUT_LOAD_FAILED' : 'CONVERT_FAILED'
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源，导出 API 不变） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 ENOENT/EBUSY），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode

// 注：tail（detail 截尾）核心在 `@lumin/node-kit`，仅主进程侧使用；
// 本模块被 renderer 引用（isRetryable），不得 re-export node-kit（会把 node-only 代码拉进 web 编译）
