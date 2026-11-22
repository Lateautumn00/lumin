/**
 * @file system-info 主进程通道注册（单同步通道 snapshot）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 只读采集系统概览；出参经 zod 校验，异常统一 SI_COLLECT_FAILED。
 */
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import { collectSnapshot, createDefaultDeps, type SystemInfoDeps } from './collect'
import { errnoCode, isStructuredError, toolError } from './errors'
import { snapshotSchema, type Snapshot } from './schema'

/**
 * 注册通道（测试可注入 deps）
 * @param ctx 主进程插件上下文
 * @param deps 采集依赖
 */
export function registerWith(ctx: MainPluginContext, deps: SystemInfoDeps = createDefaultDeps()): void {
  ctx.registerIpc('snapshot', async (): Promise<Snapshot> => {
    try {
      return snapshotSchema.parse(await collectSnapshot(deps))
    } catch (err) {
      if (isStructuredError(err)) throw err
      throw toolError('SI_COLLECT_FAILED', detailOf(err))
    }
  })
  ctx.log.info('system-info registered')
}

/** 生产注册入口（壳 tool-mains.ts 调用） */
export const registerMain: RegisterMain = (ctx) => registerWith(ctx)

/** 异常详情：优先 errno，其次 Error.message */
function detailOf(err: unknown): string {
  const code = errnoCode(err)
  if (code !== '') return code
  return err instanceof Error ? err.message : String(err)
}
