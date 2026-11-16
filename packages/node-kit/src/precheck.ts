import { errnoCode } from '@lumin/shared'

/** 独占打开失败的 errno（Windows 共享违规 / 权限拒绝） */
export const LOCK_ERRNOS: ReadonlySet<string> = new Set(['EBUSY', 'EPERM', 'EACCES'])

/** 预检错误分类：占用 / 不存在 / 其它（errno 语义，spec §5） */
export type PrecheckKind = 'locked' | 'not-found' | 'other'

/**
 * 预检错误分类（读/独占打开失败的 errno 归类）。
 * 调用方按 kind 映射各自工具的结构化错误码（locked → 占用类，not-found → 不存在类）。
 */
export function classifyPrecheckError(err: unknown): PrecheckKind {
  const code = errnoCode(err)
  if (LOCK_ERRNOS.has(code)) return 'locked'
  if (code === 'ENOENT') return 'not-found'
  return 'other'
}
