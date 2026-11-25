/**
 * @file markdown-tool renderer 类型化 invoke 封装（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-24
 * @description config/set-output-dir/save/open-file/save-file 五条同步通道封装，类型来自 schema.ts
 */
import type {
  ConfigResult,
  OpenFileResult,
  SaveFilePayload,
  SaveFileResult,
  SavePayload,
  SaveResult
} from '../schema'

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

/** 打开已有 Markdown 文档（未传 path 时弹系统对话框；取消返回 null） */
export function openMarkdownFile(path?: string): Promise<OpenFileResult | null> {
  return window.lumin.invoke<OpenFileResult | null>(
    'markdown-tool:open-file',
    path === undefined ? {} : { path }
  )
}

/** 覆盖保存 / 另存为落盘（带 mtime 冲突检测） */
export function saveMarkdownFile(payload: SaveFilePayload): Promise<SaveFileResult> {
  return window.lumin.invoke('markdown-tool:save-file', payload)
}

/** 打开输出文件所在文件夹（复用壳通道） */
export function revealPath(path: string): Promise<void> {
  return window.lumin.revealPath(path)
}
