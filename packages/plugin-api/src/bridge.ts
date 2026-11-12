import type { StructuredError, TaskEvent } from '@lumin/shared'

/** 应用信息（关于页展示） */
export interface AppInfo {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: string
  locale: string
}

/** preload 通过 contextBridge 暴露给 renderer 的唯一通道（`window.lumin`） */
export interface LuminBridge {
  /** 调用 `{toolId}:{action}` / shell 通道，返回解包后的 data 或抛出结构化错误 */
  invoke<R = unknown>(channel: string, payload?: unknown): Promise<R>
  /** 订阅任务事件（progress | log | done | error），返回取消订阅函数 */
  onTaskEvent(listener: (event: TaskEvent) => void): () => void
  getAppInfo(): Promise<AppInfo>
  openLogDir(): Promise<void>
  readonly settings: {
    get<T>(key: string, defaultValue: T): Promise<T>
    set<T>(key: string, value: T): Promise<void>
  }
}

/** invoke 失败时 preload 抛出的错误形态（renderer 捕获后按 code 分支） */
export type { StructuredError }
