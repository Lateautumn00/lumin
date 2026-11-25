/**
 * @file clients/watermark.ts 图片批量水印页签 invoke 封装（M72 合并自 image-watermark）
 * @author cuilanchao
 * @date 2026-11-25
 * @description watermark / watermark-config / watermark-set-output-dir 通道；类型来自 watermark/schema.ts
 */
import type {
  ConfigResult,
  SetOutputDirPayload,
  WatermarkPayload,
  WatermarkResult
} from '../../watermark/schema'

/** 提交批量水印任务（返回 taskId，进度经 onTaskEvent 推送） */
export function submitWatermark(payload: WatermarkPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('image-toolbox:watermark', payload)
}

/** 读取记忆的输出目录（settings `watermarkOutputDir`，缺省 userData/image-watermark） */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('image-toolbox:watermark-config', {})
}

/** 记忆输出目录（选中目录后调用；主进程顺带建目录） */
export function setOutputDir(payload: SetOutputDirPayload): Promise<ConfigResult> {
  return window.lumin.invoke('image-toolbox:watermark-set-output-dir', payload)
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

export type { WatermarkResult }
