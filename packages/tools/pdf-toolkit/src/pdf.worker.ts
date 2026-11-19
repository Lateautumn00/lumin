/**
 * @file pdf.worker.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description worker 任务入口：runOp 执行，进度经 ctx.emit 上抛（禁顶层 await）
 */
import { exposeTask, type TaskRunContext } from '@lumin/node-kit'
import { runOp, type OpResult, type WorkerRequest } from './pdf-ops'

/**
 * 任务处理器（导出便于单测；生产由 exposeTask 注册）
 * @param request op + 已校验载荷
 * @param ctx 进度上报上下文
 */
export async function handleTask(request: WorkerRequest, ctx: TaskRunContext): Promise<OpResult> {
  return runOp(request, (update) => {
    ctx.emit({ kind: 'progress', ...update })
  })
}

exposeTask<WorkerRequest, OpResult>(handleTask)
