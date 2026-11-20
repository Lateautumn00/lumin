/**
 * @file image-rotate renderer 类型化 invoke 封装（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-20
 * @description config/set-output-dir sync 通道与 process task 的提交封装，类型来自 schema.ts
 */
import type { ConfigResult, ProcessPayload } from '../schema'

/** 读取输出目录记忆（settings `outputDir`，缺省 userData/image-rotate） */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('image-rotate:config', {})
}

/** 保存输出目录记忆（选择目录后即时落盘，下次打开回填） */
export function saveOutputDir(outputDir: string): Promise<void> {
  return window.lumin.invoke('image-rotate:set-output-dir', { outputDir })
}

/** 提交批量旋转/翻转长任务，立即返回 taskId（三段式第一段） */
export function process(payload: ProcessPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('image-rotate:process', payload)
}

/** 打开输出文件所在文件夹（复用壳通道，壳侧 zod 校验非空） */
export function revealPath(path: string): Promise<void> {
  return window.lumin.revealPath(path)
}
