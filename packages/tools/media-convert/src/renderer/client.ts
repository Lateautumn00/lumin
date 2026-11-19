/**
 * @file media-convert renderer 类型化 invoke 封装（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-19
 * @description probe/config/set-output-dir 同步通道与 process 长任务的提交封装，类型来自 schema.ts
 */
import type { ConfigResult, ProbePayload, ProbeResult, ProcessPayload } from '../schema'

/** 批量探测音视频元信息（时长/分辨率/流信息；单文件失败不阻塞，见结果 failures） */
export function probe(payload: ProbePayload): Promise<ProbeResult> {
  return window.lumin.invoke('media-convert:probe', payload)
}

/** 提交批量处理长任务，立即返回 taskId（三段式第一段） */
export function process(payload: ProcessPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('media-convert:process', payload)
}

/** 读取输出目录记忆（settings `outputDir`，缺省 userData/media） */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('media-convert:config', {})
}

/** 保存输出目录记忆（选择目录后即时落盘，下次打开回填） */
export function saveOutputDir(outputDir: string): Promise<void> {
  return window.lumin.invoke('media-convert:set-output-dir', { outputDir })
}

/** 打开输出文件所在文件夹（复用壳通道，壳侧 zod 校验非空） */
export function revealPath(path: string): Promise<void> {
  return window.lumin.revealPath(path)
}
