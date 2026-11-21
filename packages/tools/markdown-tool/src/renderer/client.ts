/**
 * @file markdown-tool renderer 类型化 invoke 封装（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-21
 * @description config/set-output-dir/save 三条同步通道封装，类型来自 schema.ts
 */
import type { ConfigResult, SavePayload, SaveResult } from '../schema'

/** 读取输出目录记忆（settings `outputDir`，缺省 userData/markdown） */
export function config(): Promise<ConfigResult> {
  return window.lumin.invoke('markdown-tool:config', {})
}

/** 保存输出目录记忆（选择目录后即时落盘，下次打开回填） */
export function saveOutputDir(outputDir: string): Promise<void> {
  return window.lumin.invoke('markdown-tool:set-output-dir', { outputDir })
}

/** 导出文本产物（主进程原子写盘 + 冲突递增命名） */
export function saveFile(payload: SavePayload): Promise<SaveResult> {
  return window.lumin.invoke('markdown-tool:save', payload)
}

/** 打开输出文件所在文件夹（复用壳通道） */
export function revealPath(path: string): Promise<void> {
  return window.lumin.revealPath(path)
}
