import { exposeTask, type TaskRunContext } from '@lumin/node-kit'
import { runOp, type OpResult, type WorkerRequest } from './pdf-ops'

/**
 * 任务处理器（导出便于单测；electron-vite `?modulePath` 打包后由 exposeTask 注册）。
 * 进度经 ctx.emit → postMessage 上抛；结构化错误原样回传（exposeTask 归一），
 * 硬终止由 runTask 侧 terminate。禁顶层 await（CJS 输出格式限制）。
 */
export async function handleTask(request: WorkerRequest, ctx: TaskRunContext): Promise<OpResult> {
  return runOp(request, (update) => {
    ctx.emit({ kind: 'progress', ...update })
  })
}

exposeTask<WorkerRequest, OpResult>(handleTask)
