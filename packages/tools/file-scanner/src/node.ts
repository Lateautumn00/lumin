/**
 * @file node.ts file-scanner 主进程通道注册（三页签合并：校验 / 重复文件 / 目录对比）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 统一注册 9 个通道：hash-* / dup-* / compare-*；长任务均走 worker 三段式。
 *              各页签的 deps 可注入（vitest 传假 worker 运行器）。
 */
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import { createCompareDeps, registerCompare } from './compare/node'
import { createDuplicateDeps, registerDuplicate } from './duplicate/node'
import { createHashDeps, registerHash } from './hash/node'

/** 注册三组页签通道（生产 deps：node-kit worker 运行器） */
export function registerAll(ctx: MainPluginContext): void {
  registerHash(ctx, createHashDeps())
  registerDuplicate(ctx, createDuplicateDeps())
  registerCompare(ctx, createCompareDeps())
}

export const registerMain: RegisterMain = (ctx) => {
  registerAll(ctx)
  ctx.log.info('file-scanner registered')
}
