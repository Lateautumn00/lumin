/**
 * @file ocr-text renderer 类型化 invoke 封装（AGENTS §6：只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-19
 * @description recognize 三段式任务 + save-txt/config 同步通道；类型来自 schema.ts
 */
import type { ConfigResult, RecognizePayload, SaveTxtPayload, SaveTxtResult } from '../schema'

/** 提交识别任务（返回 taskId，进度经 onTaskEvent 推送） */
export function submitRecognize(payload: RecognizePayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('ocr-text:recognize', payload)
}

/** 读取导出目录记忆（settings `outputDir`，缺省 userData/ocr-text） */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('ocr-text:config', {})
}

/** 导出编辑后的文本为 TXT（主进程冲突递增命名 + 原子写盘） */
export function saveTxt(payload: SaveTxtPayload): Promise<SaveTxtResult> {
  return window.lumin.invoke('ocr-text:save-txt', payload)
}

/** 取消当前识别任务 */
export function cancelTask(taskId: string): Promise<void> {
  return window.lumin.invoke('lumin:task:cancel', { taskId })
}

/** 打开输出文件所在文件夹（复用壳通道） */
export function revealPath(path: string): Promise<void> {
  return window.lumin.revealPath(path)
}

/** 系统目录选择（用户取消返回 null） */
export function pickDirectory(title: string): Promise<string | null> {
  return window.lumin.pickDirectory(title)
}
