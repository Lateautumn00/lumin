/**
 * @file clients/stitch.ts 图片拼接页签 invoke 封装（M72 合并自 image-stitch）
 * @author cuilanchao
 * @date 2026-11-25
 * @description stitch / split / stitch-config / stitch-set-output-dir 通道；类型来自 stitch/schema.ts
 */
import type {
  ConfigResult,
  SetOutputDirPayload,
  SplitPayload,
  SplitResult,
  StitchPayload,
  StitchResult
} from '../../stitch/schema'

/** 提交拼接任务（返回 taskId，进度经 onTaskEvent 推送） */
export function submitStitch(payload: StitchPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('image-toolbox:stitch', payload)
}

/** 提交长图分割任务（M40，done 返回 `{outputs,sourceWidth,sourceHeight}`） */
export function split(payload: SplitPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('image-toolbox:split', payload)
}

/** 读取记忆的输出目录（settings `stitchOutputDir`，缺省 userData/image-stitch） */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('image-toolbox:stitch-config', {})
}

/** 记忆输出目录（选中目录后调用；主进程顺带建目录） */
export function setOutputDir(payload: SetOutputDirPayload): Promise<ConfigResult> {
  return window.lumin.invoke('image-toolbox:stitch-set-output-dir', payload)
}

/** 取消当前任务 */
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

/** File → 磁盘绝对路径（contextIsolation 下只经 bridge） */
export function getPathForFile(file: File): string {
  return window.lumin.getPathForFile(file)
}

export type { SplitResult, StitchResult }
