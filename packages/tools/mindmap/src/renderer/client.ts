/**
 * @file renderer 侧类型化 IPC 客户端（通道 mindmap:{action}）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 仅封装 window.lumin.invoke，类型全部由 schema 推导。
 */
import type {
  ClearDraftResult,
  LoadDraftResult,
  OpenDialogResult,
  OpenDocumentPayload,
  OpenDocumentResult,
  ReadTextFilePayload,
  ReadTextFileResult,
  SaveDocumentPayload,
  SaveDocumentResult,
  SaveDraftPayload,
  SaveDraftResult,
  WriteExportPayload,
  WriteExportResult
} from '../schema'

/**
 * 系统对话框选择 .json 文件（取消返回 null）
 */
export function openDialog(): Promise<OpenDialogResult> {
  return window.lumin.invoke<OpenDialogResult>('mindmap:open-dialog', {})
}

/**
 * 读取并解析本地 .json 文档
 * @param payload 文件路径
 */
export function openDocument(payload: OpenDocumentPayload): Promise<OpenDocumentResult> {
  return window.lumin.invoke<OpenDocumentResult>('mindmap:open-document', payload)
}

/**
 * 保存文档到指定路径
 * @param payload 路径 / 文档 / 冲突检测参数
 */
export function saveDocument(payload: SaveDocumentPayload): Promise<SaveDocumentResult> {
  return window.lumin.invoke<SaveDocumentResult>('mindmap:save-document', payload)
}

/**
 * 读取 Markdown / OPML 文本
 * @param payload 文件路径
 */
export function readTextFile(payload: ReadTextFilePayload): Promise<ReadTextFileResult> {
  return window.lumin.invoke<ReadTextFileResult>('mindmap:read-text-file', payload)
}

/**
 * 导出文件落盘（文本或 base64）
 * @param payload 路径与内容
 */
export function writeExport(payload: WriteExportPayload): Promise<WriteExportResult> {
  return window.lumin.invoke<WriteExportResult>('mindmap:write-export', payload)
}

/**
 * 读取自动保存草稿
 */
export function loadDraft(): Promise<LoadDraftResult> {
  return window.lumin.invoke<LoadDraftResult>('mindmap:load-draft', {})
}

/**
 * 写入自动保存草稿
 * @param payload 文档与来源路径
 */
export function saveDraft(payload: SaveDraftPayload): Promise<SaveDraftResult> {
  return window.lumin.invoke<SaveDraftResult>('mindmap:save-draft', payload)
}

/**
 * 清除草稿
 */
export function clearDraft(): Promise<ClearDraftResult> {
  return window.lumin.invoke<ClearDraftResult>('mindmap:clear-draft', {})
}
