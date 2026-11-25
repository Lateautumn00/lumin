/**
 * @file 试卷页面切分 worker 入口（A3 横向双页对半切）。
 * @author cuilanchao
 * @date 2026-11-25
 * @description 复用 pdf.worker 协议：electron-vite `?modulePath` 打包后由 exposeTask 注册；
 *              进度经 ctx.emit → postMessage 上抛，结构化错误原样回传；禁顶层 await。
 */
import { exposeTask, type TaskRunContext } from '@lumin/node-kit'
import { renderOcrInput } from './ocr-render'
import {
  runHalve,
  type HalveDeps,
  type HalveResult,
  type HalveWorkerRequest
} from './page-split-ops'

/** 真实依赖：pdfjs/napi 渲染（单测直接调 handleHalveTask 覆盖） */
const deps: HalveDeps = { render: renderOcrInput }

/**
 * 任务处理器（导出便于单测；打包后由 exposeTask 注册）。
 * 进度经 ctx.emit → postMessage 上抛；硬终止由 runTask 侧 terminate。
 */
export async function handleHalveTask(
  request: HalveWorkerRequest,
  ctx: TaskRunContext
): Promise<HalveResult> {
  return runHalve(request.inputPath, deps, (update) => {
    ctx.emit({ kind: 'progress', ...update })
  })
}

exposeTask<HalveWorkerRequest, HalveResult>(handleHalveTask)
