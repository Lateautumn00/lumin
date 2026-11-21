/**
 * @file index.ts node-kit 的 PDF 子路径入口（`@lumin/node-kit/pdf`）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 仅导出 PDF 渲染原语；不从 node-kit 根入口再导出，
 *              避免所有主进程工具被动引入 pdfjs/原生画布依赖。
 */
export {
  encodeCanvas,
  ensureCjkFont,
  loadPdfjs,
  openPdf,
  renderPageToCanvas
} from './render'
export type { OpenedPdf, PdfDocumentHandle, PdfPageHandle, RenderedCanvas } from './render'
export {
  buildPageText,
  decodeRawImage,
  ExtractedImageLimitError,
  extractPdfImages,
  extractPdfText,
  toTextItems
} from './extract'
export type {
  DecodedImage,
  ExtractedImage,
  ExtractedText,
  ExtractedTextPage,
  ExtractImageOptions,
  PdfRawImage,
  PdfTextItem
} from './extract'
