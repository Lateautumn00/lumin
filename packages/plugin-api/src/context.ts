import type { TaskUpdate } from '@lumin/shared'
import type { ToolManifest } from './manifest'

/** 单次 invoke 的处理上下文（payload 由工具自带 zod schema 校验） */
export interface IpcHandlerContext<P> {
  readonly toolId: string
  readonly action: string
  readonly payload: P
}

export type IpcHandler<P = unknown, R = unknown> = (ctx: IpcHandlerContext<P>) => R | Promise<R>

/** 长任务处理上下文：cancel → abort signal；emit 推送 progress/log */
export interface TaskHandlerContext<P> extends IpcHandlerContext<P> {
  readonly taskId: string
  readonly signal: AbortSignal
  readonly emit: (update: TaskUpdate) => void
}

export type TaskHandler<P = unknown, R = unknown> = (ctx: TaskHandlerContext<P>) => Promise<R>

/** 工具作用域的设置读写（主进程按 toolId 自动命名空间隔离） */
export interface ToolSettings {
  get<T>(key: string, defaultValue: T): Promise<T>
  set<T>(key: string, value: T): Promise<void>
}

/** 结构化日志（electron-log，按 toolId 打标签，滚动文件见 shell services/log） */
export interface ToolLogger {
  debug(message: string, ...meta: unknown[]): void
  info(message: string, ...meta: unknown[]): void
  warn(message: string, ...meta: unknown[]): void
  error(message: string, ...meta: unknown[]): void
}

/** 工具可用的应用目录（由壳注入，工具不得自行猜测 userData/temp 位置） */
export interface ToolPaths {
  /** 系统临时目录（长任务工作区、独立 profile 建于此） */
  readonly temp: string
  /** 应用 userData 目录（便携组件等大文件落这里） */
  readonly userData: string
  /** 外部二进制/模型根目录（fetch-binaries.mjs 产物；开发态=仓库根 binaries/，打包态=resources/binaries） */
  readonly binaries: string
}

/** 主进程插件上下文：工具 node.ts 的 `registerMain(ctx)` 入参 */
export interface MainPluginContext {
  readonly toolId: string
  readonly manifest: ToolManifest
  registerIpc<P = unknown, R = unknown>(action: string, handler: IpcHandler<P, R>): void
  registerTask<P = unknown, R = unknown>(action: string, handler: TaskHandler<P, R>): void
  readonly settings: ToolSettings
  readonly log: ToolLogger
  readonly paths: ToolPaths
}

export type RegisterMain = (ctx: MainPluginContext) => void | Promise<void>
