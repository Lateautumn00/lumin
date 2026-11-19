/**
 * @file 试卷切割 OCR 渲染入口（薄壳：实现已上提至 @lumin/ocr-kit）
 * @author cuilanchao
 * @date 2026-11-16
 * @description 渲染实现上提至 ocr-kit 后，本文件保留 exam-split 专属倍率约束：
 *              PDF 渲染固定注入既有 `PDF_RENDER_SCALE`，保证 M3b 渲染结果零回归。
 */
import {
  renderOcrInput as renderOcrInputFromKit,
  type RenderOptions,
  type RenderedPage
} from '@lumin/ocr-kit'
import { PDF_RENDER_SCALE } from './preview'

export { PDF_RENDER_SCALE } from './preview'
export { ensureCjkFont } from '@lumin/node-kit/pdf'
export { classifyPdfjsError, classifyReadError, encodePng, rotatedSize } from '@lumin/ocr-kit'
export type { RenderOptions, RenderedPage }

/**
 * 兼容包装：PDF 渲染倍率固定为 exam-split 既有 `PDF_RENDER_SCALE`（1.5）。
 * 其余选项（页码子集/旋转/进度）原样透传。
 */
export function renderOcrInput(
  inputPath: string,
  options: RenderOptions = {}
): Promise<RenderedPage[]> {
  return renderOcrInputFromKit(inputPath, { ...options, scale: PDF_RENDER_SCALE })
}
