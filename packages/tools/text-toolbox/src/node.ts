/**
 * @file node.ts text-toolbox 主进程通道注册（M77 并入「编辑」/「对比」两页签）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 文本编辑（open/save/save-as）与文本对比（pick-file/compare-files/copy-text）
 *              原为独立工具，合并后经上下文适配器分别加 `editor-` / `diff-` 通道前缀，
 *              子模块仍按自身裸 action 编写，合并后互不冲突且单测零改动。
 */
import type { IpcHandler, MainPluginContext, RegisterMain, TaskHandler } from '@lumin/plugin-api'
import { registerMain as registerEditorMain } from './editor/node'
import { registerMain as registerDiffMain } from './diff/node'

/** 并入页签前缀（通道 `{prefix}-{action}`，settings 键 `{prefix}.{key}`） */
type MergedPrefix = 'editor' | 'diff'

/**
 * 子功能上下文适配（M73 同口径）：通道加 `{prefix}-`、settings 键加 `{prefix}.` 前缀
 * @param ctx 宿主主进程上下文
 * @param prefix 页签前缀（editor / diff）
 */
function namespacedContext(ctx: MainPluginContext, prefix: MergedPrefix): MainPluginContext {
  return {
    ...ctx,
    registerIpc: <P, R>(action: string, handler: IpcHandler<P, R>) =>
      ctx.registerIpc(`${prefix}-${action}`, handler),
    registerTask: <P, R>(action: string, handler: TaskHandler<P, R>) =>
      ctx.registerTask(`${prefix}-${action}`, handler),
    settings: {
      get: <T>(key: string, defaultValue: T) => ctx.settings.get(`${prefix}.${key}`, defaultValue),
      set: <T>(key: string, value: T) => ctx.settings.set(`${prefix}.${key}`, value)
    }
  }
}

/** 注册并入页签通道（editor-* / diff-*） */
export const registerMain: RegisterMain = (ctx) => {
  registerEditorMain(namespacedContext(ctx, 'editor'))
  registerDiffMain(namespacedContext(ctx, 'diff'))
  ctx.log.info('text-toolbox registered')
}
