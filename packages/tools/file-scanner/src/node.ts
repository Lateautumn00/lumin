/**
 * @file node.ts file-scanner 主进程通道注册（七页签：校验 / 重复文件 / 目录对比 / 重命名 / 清理 / 磁盘分析 / 压缩包）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 校验 / 重复 / 对比沿用 hash-* / dup-* / compare-* 通道；
 *              M75 并入的 rename / clean / disk 与 M81 并入的 zip 页签经上下文适配器加 `{prefix}-` 前缀注册，
 *              子模块仍按自身裸 action 编写，合并后互不冲突且单测零改动。
 *              各页签的 deps 可注入（vitest 传假 worker 运行器）。
 */
import type { IpcHandler, MainPluginContext, RegisterMain, TaskHandler } from '@lumin/plugin-api'
import { createCompareDeps, registerCompare } from './compare/node'
import { createDuplicateDeps, registerDuplicate } from './duplicate/node'
import { createHashDeps, registerHash } from './hash/node'
import { registerMain as registerRenameMain } from './rename/node'
import { registerMain as registerCleanMain } from './clean/node'
import { registerMain as registerDiskMain } from './disk/node'
import { registerMain as registerZipMain } from './zip/node'

/** 并入页签前缀（通道 `{prefix}-{action}`，settings 键 `{prefix}.{key}`） */
type MergedPrefix = 'rename' | 'clean' | 'disk' | 'zip'

/**
 * 子功能上下文适配（M73 同口径）：通道加 `{prefix}-`、settings 键加 `{prefix}.` 前缀，
 * 子模块仍按自身裸 action / 裸键编写，合并后互不冲突且单测零改动
 * @param ctx 宿主主进程上下文
 * @param prefix 页签前缀（rename / clean / disk）
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

/** 注册全部页签通道（生产 deps：node-kit worker 运行器） */
export function registerAll(ctx: MainPluginContext): void {
  registerHash(ctx, createHashDeps())
  registerDuplicate(ctx, createDuplicateDeps())
  registerCompare(ctx, createCompareDeps())
  // M75 并入页签：通道 rename-* / clean-* / disk-*
  registerRenameMain(namespacedContext(ctx, 'rename'))
  registerCleanMain(namespacedContext(ctx, 'clean'))
  registerDiskMain(namespacedContext(ctx, 'disk'))
  // M81 并入页签：通道 zip-* / settings zip.*
  registerZipMain(namespacedContext(ctx, 'zip'))
}

export const registerMain: RegisterMain = (ctx) => {
  registerAll(ctx)
  ctx.log.info('file-scanner registered')
}
