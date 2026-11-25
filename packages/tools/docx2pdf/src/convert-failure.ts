/**
 * @file docx2pdf 转换失败归类（仅主进程使用）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 依赖 `@lumin/node-kit/office`（含 node:path 等 Node 能力），只允许 node.ts 引用；
 *              renderer 侧请从 `./errors` 取错误码与文案，禁止引用本模块。
 */
import { classifyConvertFailure } from '@lumin/node-kit/office'
import type { Docx2pdfErrorCode } from './errors'

/** 通用转换失败归类 → 本工具错误码（源文件无法加载 / 其余转换失败） */
export function convertFailureCode(stderr: string): Docx2pdfErrorCode {
  return classifyConvertFailure(stderr) === 'load' ? 'INPUT_LOAD_FAILED' : 'CONVERT_FAILED'
}
