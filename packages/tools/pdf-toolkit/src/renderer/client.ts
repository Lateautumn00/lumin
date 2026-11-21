/**
 * @file client.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description pdf-toolkit renderer 类型化 invoke 封装（只经 window.lumin 白名单 bridge）
 */
import type {
  CompressPayload,
  DeletePayload,
  ExtractImagesPayload,
  ExtractTextPayload,
  InfoPayload,
  InfoResult,
  MergePayload,
  MetadataPayload,
  PageNumberPayload,
  ReorderPayload,
  RotatePayload,
  SplitPayload,
  WatermarkPayload
} from '../schema'

/** 读取页数/元数据（同步通道） */
export function info(payload: InfoPayload): Promise<InfoResult> {
  return window.lumin.invoke('pdf-toolkit:info', payload)
}

/** 合并（三段式第一段，返回 taskId） */
export function merge(payload: MergePayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('pdf-toolkit:merge', payload)
}

/** 拆分 */
export function split(payload: SplitPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('pdf-toolkit:split', payload)
}

/** 删页 */
export function deletePages(payload: DeletePayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('pdf-toolkit:delete', payload)
}

/** 旋转 */
export function rotate(payload: RotatePayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('pdf-toolkit:rotate', payload)
}

/** 重排 */
export function reorder(payload: ReorderPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('pdf-toolkit:reorder', payload)
}

/** 元数据 */
export function saveMetadata(payload: MetadataPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('pdf-toolkit:metadata', payload)
}

/** 水印 */
export function watermark(payload: WatermarkPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('pdf-toolkit:watermark', payload)
}

/** 页码 */
export function pageNumbers(payload: PageNumberPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('pdf-toolkit:page-numbers', payload)
}

/** 文本提取（M38） */
export function extractText(payload: ExtractTextPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('pdf-toolkit:extract-text', payload)
}

/** 图片提取（M38） */
export function extractImages(payload: ExtractImagesPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('pdf-toolkit:extract-images', payload)
}

/** 压缩（M38） */
export function compress(payload: CompressPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('pdf-toolkit:compress', payload)
}

/** 取消任务（壳通道） */
export function cancelTask(taskId: string): Promise<boolean> {
  return window.lumin.invoke('lumin:task:cancel', { taskId })
}

/** 打开产物所在文件夹（壳通道） */
export function revealPath(path: string): Promise<void> {
  return window.lumin.revealPath(path)
}
