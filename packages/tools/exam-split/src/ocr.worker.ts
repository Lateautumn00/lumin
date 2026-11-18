import { exposeTask, type TaskRunContext } from '@lumin/node-kit'
import { createOcrEngine } from './ocr-model'
import { runOcrOp, type OcrDeps, type OcrTaskResult, type OcrWorkerRequest } from './ocr-ops'
import { renderOcrInput } from './ocr-render'

/** 真实依赖：pdfjs/napi 渲染 + onnxruntime-node 推理（单测直接调 handleOcrTask 覆盖） */
const deps: OcrDeps = {
  render: renderOcrInput,
  createEngine: createOcrEngine
}

/**
 * 任务处理器（导出便于单测；electron-vite `?modulePath` 打包后由 exposeTask 注册）。
 * 进度经 ctx.emit → postMessage 上抛；结构化错误原样回传（exposeTask 归一），
 * 硬终止由 runTask 侧 terminate。禁顶层 await（CJS 输出格式限制）。
 */
export async function handleOcrTask(
  request: OcrWorkerRequest,
  ctx: TaskRunContext
): Promise<OcrTaskResult> {
  return runOcrOp(request, deps, (update) => {
    ctx.emit({ kind: 'progress', ...update })
  })
}

exposeTask<OcrWorkerRequest, OcrTaskResult>(handleOcrTask)
