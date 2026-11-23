/**
 * @file file-preview renderer 类型化 invoke 封装（renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 8 条通道：inspect/read-text/asset-url/convert-office/render-pdf-page/
 *              release-preview/soffice-status/set-soffice-path；类型来自 schema.ts。
 */
import type {
  AssetUrlPayload,
  AssetUrlResult,
  ConvertOfficePayload,
  InspectPayload,
  InspectResult,
  ReadTextPayload,
  ReadTextResult,
  ReleasePreviewPayload,
  ReleasePreviewResult,
  RenderPdfPagePayload,
  RenderPdfPageResult,
  SetSofficePathPayload,
  SofficeStatusResult
} from '../schema'

/** 判定文件类型 + 体积（PDF 同时登记预览会话） */
export function inspect(payload: InspectPayload): Promise<InspectResult> {
  return window.lumin.invoke('file-preview:inspect', payload)
}

/** 读取文本（2MiB 截断；返回编码/EOL/truncated） */
export function readText(payload: ReadTextPayload): Promise<ReadTextResult> {
  return window.lumin.invoke('file-preview:read-text', payload)
}

/** 图片 → file:// URL */
export function assetUrl(payload: AssetUrlPayload): Promise<AssetUrlResult> {
  return window.lumin.invoke('file-preview:asset-url', payload)
}

/** 提交 Office → PDF 转换任务（返回 taskId，进度经 onTaskEvent） */
export function convertOffice(payload: ConvertOfficePayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('file-preview:convert-office', payload)
}

/** 渲染 PDF 单页为 PNG base64 */
export function renderPdfPage(payload: RenderPdfPagePayload): Promise<RenderPdfPageResult> {
  return window.lumin.invoke('file-preview:render-pdf-page', payload)
}

/** 释放 PDF 预览会话（Office 临时 PDF 一并删除） */
export function releasePreview(payload: ReleasePreviewPayload): Promise<ReleasePreviewResult> {
  return window.lumin.invoke('file-preview:release-preview', payload)
}

/** 查询 soffice 当前定位结果 */
export function sofficeStatus(): Promise<SofficeStatusResult> {
  return window.lumin.invoke('file-preview:soffice-status', {})
}

/** 保存自定义 soffice 路径（空串清除）并返回复核结果 */
export function setSofficePath(payload: SetSofficePathPayload): Promise<SofficeStatusResult> {
  return window.lumin.invoke('file-preview:set-soffice-path', payload)
}
