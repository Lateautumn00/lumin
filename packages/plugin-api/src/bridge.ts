import type { StructuredError, TaskEvent, UpdateEvent } from '@lumin/shared'

/** 应用信息（关于页展示） */
export interface AppInfo {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: string
  locale: string
}

/** 移入回收站结果（逐条容错：单条失败不影响其余） */
export interface TrashOutcome {
  /** 已成功移入回收站的路径 */
  trashed: string[]
  /** 失败项（message 为系统错误文本） */
  failed: { path: string; message: string }[]
}

/** preload 通过 contextBridge 暴露给 renderer 的唯一通道（`window.lumin`） */
export interface LuminBridge {
  /** 调用 `{toolId}:{action}` / shell 通道，返回解包后的 data 或抛出结构化错误 */
  invoke<R = unknown>(channel: string, payload?: unknown): Promise<R>
  /** 订阅任务事件（progress | log | done | error），返回取消订阅函数 */
  onTaskEvent(listener: (event: TaskEvent) => void): () => void
  /** 订阅更新事件（checking | available | not-available | downloading | downloaded | error） */
  onUpdateEvent(listener: (event: UpdateEvent) => void): () => void
  getAppInfo(): Promise<AppInfo>
  openLogDir(): Promise<void>
  /** 拖拽/文件选择器拿到的 File → 磁盘绝对路径（contextIsolation 下 File.path 已移除） */
  getPathForFile(file: File): string
  /** 在资源管理器中定位文件/目录（shell.showItemInFolder） */
  revealPath(path: string): Promise<void>
  /** 移入系统回收站（shell.trashItem；单批 ≤200，逐条容错，不做永久删除） */
  trashPaths(paths: readonly string[]): Promise<TrashOutcome>
  /** 系统目录选择对话框；用户取消返回 null（壳通用能力，多工具复用） */
  pickDirectory(title?: string): Promise<string | null>
  readonly settings: {
    get<T>(key: string, defaultValue: T): Promise<T>
    set<T>(key: string, value: T): Promise<void>
  }
}

declare global {
  interface Window {
    lumin: LuminBridge
  }
}

/** invoke 失败时 preload 抛出的错误形态（renderer 捕获后按 code 分支） */
export type { StructuredError }
