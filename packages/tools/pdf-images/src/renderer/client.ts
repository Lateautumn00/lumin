/**
 * @file pdf-images renderer 类型化 invoke 封装（AGENTS §6：只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-19
 * @description pdf-info/config/set-output-dir 同步通道 + pdf-to-images/images-to-pdf 三段式任务提交
 */
import type {
  ConfigResult,
  ImagesToPdfPayload,
  PdfInfoPayload,
  PdfInfoResult,
  PdfToImagesPayload,
  SetOutputDirPayload
} from '../schema'

/** 读取 PDF 页数（同步通道；失败抛结构化错误） */
export function pdfInfo(payload: PdfInfoPayload): Promise<PdfInfoResult> {
  return window.lumin.invoke('pdf-images:pdf-info', payload)
}

/** 读取输出目录记忆（settings `outputDir`，缺省 userData/pdf-images-output） */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('pdf-images:config', {})
}

/** 保存输出目录记忆（选择目录后即时落盘，下次打开回填） */
export function saveOutputDir(payload: SetOutputDirPayload): Promise<ConfigResult> {
  return window.lumin.invoke('pdf-images:set-output-dir', payload)
}

/** 提交 PDF→图片长任务，立即返回 taskId（三段式第一段） */
export function pdfToImages(payload: PdfToImagesPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('pdf-images:pdf-to-images', payload)
}

/** 提交 图片→PDF 长任务，立即返回 taskId（三段式第一段） */
export function imagesToPdf(payload: ImagesToPdfPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('pdf-images:images-to-pdf', payload)
}

/** 打开输出文件所在文件夹（复用壳通道） */
export function revealPath(path: string): Promise<void> {
  return window.lumin.revealPath(path)
}
