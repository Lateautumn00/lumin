import { createOcrEngine, renderOcrInput } from '@lumin/ocr-kit'
import { exposeTask, type TaskRunContext } from '@lumin/node-kit'
import {
  runRecognize,
  type RecognizeDeps,
  type RecognizeRequest
} from './recognize'
import type { RecognizeResult } from './schema'

/** 真实依赖：pdfjs/canvas 渲染 + onnxruntime-node 推理（单测直接调 handleOcrTextTask） */
const deps: RecognizeDeps = {
  render: renderOcrInput,
  createEngine: createOcrEngine
}

/**
 * 任务处理器（导出便于单测；electron-vite `?modulePath` 打包后由 exposeTask 注册）。
 * 进度经 ctx.emit → postMessage 上抛；结构化错误原样回传（exposeTask 归一）。
 */
export async function handleOcrTextTask(
  request: RecognizeRequest,
  ctx: TaskRunContext
): Promise<RecognizeResult> {
  return runRecognize(request, deps, (update) => {
    ctx.emit({ kind: 'progress', ...update })
  })
}

exposeTask<RecognizeRequest, RecognizeResult>(handleOcrTextTask)
