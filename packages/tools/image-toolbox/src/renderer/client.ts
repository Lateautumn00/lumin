/**
 * @file image-toolbox renderer 类型化 invoke 封装（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-18
 * @description probe/config sync 通道与 process task 的提交封装，类型来自 schema.ts
 */
import type {
  AppendHistoryPayload,
  CollectFolderPayload,
  CollectFolderResult,
  ConfigResult,
  HistoryResult,
  MakeGifPayload,
  ProbePayload,
  ProbeResult,
  ProcessPayload
} from '../schema'

/** 批量探测图片元信息（尺寸/大小/是否动图；单张失败不阻塞，见结果 failures） */
export function probe(payload: ProbePayload): Promise<ProbeResult> {
  return window.lumin.invoke('image-toolbox:probe', payload)
}

/** 提交批量处理长任务，立即返回 taskId（三段式第一段） */
export function process(payload: ProcessPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('image-toolbox:process', payload)
}

/** 提交 GIF 生成任务（M40，done 返回 `{outputPath,width,height,frames,sizeBytes}`） */
export function makeGif(payload: MakeGifPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('image-toolbox:make-gif', payload)
}

/** 读取输出目录记忆（settings `outputDir`，缺省 userData/images） */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('image-toolbox:config', {})
}

/** 保存输出目录记忆（选择目录后即时落盘，下次打开回填） */
export function saveOutputDir(outputDir: string): Promise<void> {
  return window.lumin.invoke('image-toolbox:set-output-dir', { outputDir })
}

/** 打开输出文件所在文件夹（复用壳通道，壳侧 zod 校验非空） */
export function revealPath(path: string): Promise<void> {
  return window.lumin.revealPath(path)
}

/** 递归收集文件夹内的支持图片（M63，P1-6） */
export function collectFolder(payload: CollectFolderPayload): Promise<CollectFolderResult> {
  return window.lumin.invoke('image-toolbox:collect-folder', payload)
}

/** 追加一条处理历史（M63：返回最新 20 条，新 → 旧） */
export function appendHistory(payload: AppendHistoryPayload): Promise<HistoryResult> {
  return window.lumin.invoke('image-toolbox:append-history', payload)
}

/** 清空处理历史（M63） */
export function clearHistory(): Promise<HistoryResult> {
  return window.lumin.invoke('image-toolbox:clear-history', {})
}
