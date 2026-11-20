/**
 * @file archive.worker.ts 打包/解压任务入口（worker 线程，按 mode 分派）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 仅做协议编排（进度归一）；核心实现在 archive.ts（便于单测）。
 *              取消由主进程 terminate worker（node-kit runTask），无需心跳。
 */
import { exposeTask, type TaskRunContext } from '@lumin/node-kit'
import type { TaskUpdate } from '@lumin/shared'
import { runPack, runUnpack, type ArchiveProgress } from './archive'
import type { ArchiveRequest, ArchiveResult } from './schema'

/** 进度适配：archive.ts 的 progress → 壳 TaskUpdate（message 空串不传） */
export function toProgressEmitter(ctx: TaskRunContext): ArchiveProgress {
  return (progress) => {
    const update =
      progress.message === undefined || progress.message === ''
        ? {
            kind: 'progress' as const,
            current: progress.current,
            total: progress.total,
            stage: progress.stage
          }
        : {
            kind: 'progress' as const,
            current: progress.current,
            total: progress.total,
            stage: progress.stage,
            message: progress.message
          }
    ctx.emit(update satisfies TaskUpdate)
  }
}

/**
 * 任务分派（导出供单测直接调用）
 * @param request 模式 + payload
 * @param ctx 任务上下文
 */
export function handleArchiveTask(
  request: ArchiveRequest,
  ctx: TaskRunContext
): Promise<ArchiveResult> {
  const emit = toProgressEmitter(ctx)
  if (request.mode === 'pack') {
    return runPack(request.payload, emit)
  }
  return Promise.resolve(runUnpack(request.payload, emit))
}

exposeTask<ArchiveRequest, ArchiveResult>(handleArchiveTask)
