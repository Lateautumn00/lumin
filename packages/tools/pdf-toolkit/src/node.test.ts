import type { MainPluginContext } from '@lumin/plugin-api'
import { TaskCrashError, TaskTimeoutError, type RunTaskOptions } from '@lumin/node-kit'
import type { TaskUpdate } from '@lumin/shared'
import { describe, expect, it } from 'vitest'
import { toolError } from './errors'
import {
  classifyPdfError,
  createNodeDeps,
  OP_TIMEOUT_MS,
  registerMain,
  registerWith,
  type PdfToolkitDeps
} from './node'
import type { WorkerRequest } from './pdf-ops'
import type { PdfMetadata } from './schema'

/** 空元数据快照 */
const EMPTY_META: PdfMetadata = {
  title: '',
  author: '',
  subject: '',
  keywords: '',
  creator: '',
  producer: ''
}

type IpcHandler = (args: { payload: unknown }) => Promise<unknown>
type TaskHandler = (args: {
  payload: unknown
  signal: AbortSignal
  emit: (update: TaskUpdate) => void
}) => Promise<unknown>

interface Harness {
  ipc: Map<string, IpcHandler>
  tasks: Map<string, TaskHandler>
}

function makeCtx(): { ctx: MainPluginContext; harness: Harness } {
  const ipc = new Map<string, IpcHandler>()
  const tasks = new Map<string, TaskHandler>()
  const ctx = {
    registerIpc: (action: string, handler: IpcHandler) => {
      ipc.set(action, handler)
    },
    registerTask: (action: string, handler: TaskHandler) => {
      tasks.set(action, handler)
    }
  } as unknown as MainPluginContext
  return { ctx, harness: { ipc, tasks } }
}

function getIpc(harness: Harness, name: string): IpcHandler {
  const handler = harness.ipc.get(name)
  if (!handler) throw new Error(`ipc ${name} 未注册`)
  return handler
}

function getTask(harness: Harness, name: string): TaskHandler {
  const handler = harness.tasks.get(name)
  if (!handler) throw new Error(`task ${name} 未注册`)
  return handler
}

function makeDeps(overrides: Partial<PdfToolkitDeps> = {}): {
  deps: PdfToolkitDeps
  runs: RunTaskOptions<WorkerRequest>[]
} {
  const runs: RunTaskOptions<WorkerRequest>[] = []
  const deps: PdfToolkitDeps = {
    workerPath: 'C:/fake/pdf.worker.mjs',
    inspect: async () => ({ pageCount: 3, metadata: EMPTY_META }),
    checkReadable: async () => undefined,
    checkExclusive: async () => undefined,
    run: async <P, R>(options: RunTaskOptions<P>): Promise<R> => {
      runs.push(options as unknown as RunTaskOptions<WorkerRequest>)
      return { outputPaths: ['C:/out.pdf'] } as unknown as R
    },
    ...overrides
  }
  return { deps, runs }
}

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

describe('pdf-toolkit node:info', () => {
  it('返回页数、文件名与元数据', async () => {
    const { ctx, harness } = makeCtx()
    const { deps } = makeDeps({
      inspect: async () => ({
        pageCount: 7,
        metadata: { ...EMPTY_META, title: '卷标题' }
      })
    })
    registerWith(ctx, deps)
    await expect(
      getIpc(harness, 'info')({ payload: { inputPath: 'C:/文档/期末 卷.pdf' } })
    ).resolves.toEqual({
      pageCount: 7,
      fileName: '期末 卷.pdf',
      metadata: { ...EMPTY_META, title: '卷标题' }
    })
  })

  it('非法载荷 → INVALID_PAYLOAD', async () => {
    const { ctx, harness } = makeCtx()
    registerWith(ctx, makeDeps().deps)
    await expect(
      getIpc(harness, 'info')({ payload: { inputPath: 'a.txt' } })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
  })

  it('文件占用 → PT_PDF_LOCKED；不存在 → PT_INPUT_INVALID', async () => {
    const locked = makeCtx()
    registerWith(
      locked.ctx,
      makeDeps({
        checkExclusive: async () => {
          throw errnoError('EBUSY')
        }
      }).deps
    )
    await expect(
      getIpc(locked.harness, 'info')({ payload: { inputPath: 'C:/a.pdf' } })
    ).rejects.toMatchObject({ code: 'PT_PDF_LOCKED' })

    const missing = makeCtx()
    registerWith(
      missing.ctx,
      makeDeps({
        checkReadable: async () => {
          throw errnoError('ENOENT')
        }
      }).deps
    )
    await expect(
      getIpc(missing.harness, 'info')({ payload: { inputPath: 'C:/a.pdf' } })
    ).rejects.toMatchObject({ code: 'PT_INPUT_INVALID' })
  })

  it('inspect 抛结构化错误原样透传', async () => {
    const { ctx, harness } = makeCtx()
    registerWith(
      ctx,
      makeDeps({
        inspect: async () => {
          throw toolError('PT_PDF_CORRUPT', 'bad')
        }
      }).deps
    )
    await expect(
      getIpc(harness, 'info')({ payload: { inputPath: 'C:/a.pdf' } })
    ).rejects.toMatchObject({ code: 'PT_PDF_CORRUPT' })
  })
})

describe('pdf-toolkit node:任务通道', () => {
  const input = 'C:/文档/卷.pdf'

  it('merge 传 op 与载荷，超时 120s，进度上抛', async () => {
    const { ctx, harness } = makeCtx()
    const { deps, runs } = makeDeps()
    registerWith(ctx, deps)
    const updates: TaskUpdate[] = []
    const result = await getTask(
      harness,
      'merge'
    )({
      payload: { inputPaths: [input, 'C:/b.pdf'] },
      signal: new AbortController().signal,
      emit: (update) => updates.push(update)
    })
    expect(result).toEqual({ outputPaths: ['C:/out.pdf'] })
    expect(runs).toHaveLength(1)
    expect(runs[0]?.workerPath).toBe('C:/fake/pdf.worker.mjs')
    expect(runs[0]?.timeoutMs).toBe(OP_TIMEOUT_MS)
    expect(runs[0]?.payload).toEqual({ op: 'merge', payload: { inputPaths: [input, 'C:/b.pdf'] } })
    runs[0]?.onUpdate?.({ kind: 'progress', stage: 'process', current: 1, total: 2 })
    expect(updates).toEqual([{ kind: 'progress', stage: 'process', current: 1, total: 2 }])
  })

  it('split/delete/rotate/reorder/metadata/watermark/page-numbers 映射到对应 op', async () => {
    const { ctx, harness } = makeCtx()
    const { deps, runs } = makeDeps()
    registerWith(ctx, deps)
    const base = { signal: new AbortController().signal, emit: (): void => undefined }
    await getTask(harness, 'split')({ ...base, payload: { inputPath: input, ranges: '1-2' } })
    await getTask(harness, 'delete')({ ...base, payload: { inputPath: input, ranges: '1' } })
    await getTask(
      harness,
      'rotate'
    )({
      ...base,
      payload: { inputPath: input, degrees: 180 }
    })
    await getTask(harness, 'reorder')({ ...base, payload: { inputPath: input, order: [2, 1] } })
    await getTask(
      harness,
      'metadata'
    )({
      ...base,
      payload: { inputPath: input, metadata: { title: 'T' } }
    })
    await getTask(
      harness,
      'watermark'
    )({
      ...base,
      payload: {
        kind: 'text',
        inputPath: input,
        imageData: 'iVBORw0KGgo=',
        opacity: 0.4,
        angle: 45,
        scale: 20,
        tile: false
      }
    })
    await getTask(
      harness,
      'page-numbers'
    )({
      ...base,
      payload: {
        inputPath: input,
        format: '{n}/{total}',
        position: 'bottom-center',
        startPage: 2,
        fontSize: 12,
        color: '#333333',
        margin: 24
      }
    })
    expect(runs.map((run) => run.payload.op)).toEqual([
      'split',
      'delete',
      'rotate',
      'reorder',
      'metadata',
      'watermark',
      'page-numbers'
    ])
  })

  it('水印图片预检失败 → PT_WATERMARK_INVALID', async () => {
    const { ctx, harness } = makeCtx()
    const { deps, runs } = makeDeps({
      checkReadable: async (path: string) => {
        if (path.endsWith('.png')) throw errnoError('ENOENT')
      }
    })
    registerWith(ctx, deps)
    await expect(
      getTask(
        harness,
        'watermark'
      )({
        payload: {
          kind: 'image',
          inputPath: input,
          imagePath: 'C:/文档/缺失.png',
          opacity: 0.4,
          angle: 0,
          scale: 20,
          tile: false
        },
        signal: new AbortController().signal,
        emit: () => undefined
      })
    ).rejects.toMatchObject({ code: 'PT_WATERMARK_INVALID', detail: 'ENOENT' })
    expect(runs).toHaveLength(0)
  })

  it('非法载荷不发 worker', async () => {
    const { ctx, harness } = makeCtx()
    const { deps, runs } = makeDeps()
    registerWith(ctx, deps)
    await expect(
      getTask(
        harness,
        'merge'
      )({
        payload: { inputPaths: [input] },
        signal: new AbortController().signal,
        emit: () => undefined
      })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    await expect(
      getTask(
        harness,
        'watermark'
      )({
        payload: { kind: 'text', inputPath: input, opacity: 0.4, angle: 0, scale: 20, tile: false },
        signal: new AbortController().signal,
        emit: () => undefined
      })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    await expect(
      getTask(
        harness,
        'page-numbers'
      )({
        payload: {
          inputPath: input,
          format: '第 {n} 页',
          position: 'bottom-center',
          startPage: 1,
          fontSize: 12,
          color: '#333333',
          margin: 24
        },
        signal: new AbortController().signal,
        emit: () => undefined
      })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(runs).toHaveLength(0)
  })

  it('超时 → PT_TIMEOUT；崩溃 → PT_OP_FAILED；结构化错误透传', async () => {
    const timeout = makeCtx()
    registerWith(
      timeout.ctx,
      makeDeps({
        run: async () => {
          throw new TaskTimeoutError(OP_TIMEOUT_MS)
        }
      }).deps
    )
    await expect(
      getTask(
        timeout.harness,
        'split'
      )({
        payload: { inputPath: input, ranges: '1' },
        signal: new AbortController().signal,
        emit: () => undefined
      })
    ).rejects.toMatchObject({ code: 'PT_TIMEOUT' })

    const crash = makeCtx()
    registerWith(
      crash.ctx,
      makeDeps({
        run: async () => {
          throw new TaskCrashError('worker 执行异常', new Error('boom'))
        }
      }).deps
    )
    await expect(
      getTask(
        crash.harness,
        'delete'
      )({
        payload: { inputPath: input, ranges: '1' },
        signal: new AbortController().signal,
        emit: () => undefined
      })
    ).rejects.toMatchObject({ code: 'PT_OP_FAILED', detail: 'boom' })

    const noCause = makeCtx()
    registerWith(
      noCause.ctx,
      makeDeps({
        run: async () => {
          throw new TaskCrashError('worker 无 cause')
        }
      }).deps
    )
    await expect(
      getTask(
        noCause.harness,
        'delete'
      )({
        payload: { inputPath: input, ranges: '1' },
        signal: new AbortController().signal,
        emit: () => undefined
      })
    ).rejects.toMatchObject({ code: 'PT_OP_FAILED', detail: 'worker 无 cause' })

    const structured = makeCtx()
    registerWith(
      structured.ctx,
      makeDeps({
        run: async () => {
          throw toolError('PT_RANGE_INVALID', 'overflow')
        }
      }).deps
    )
    await expect(
      getTask(
        structured.harness,
        'rotate'
      )({
        payload: { inputPath: input, degrees: 90 },
        signal: new AbortController().signal,
        emit: () => undefined
      })
    ).rejects.toMatchObject({ code: 'PT_RANGE_INVALID' })
  })
})

describe('pdf-toolkit node:错误分类与默认依赖', () => {
  it('classifyPdfError 覆盖占用/缺失/加密/损坏/透传', () => {
    expect(classifyPdfError(errnoError('EBUSY'))).toMatchObject({ code: 'PT_PDF_LOCKED' })
    expect(classifyPdfError(errnoError('ENOENT'))).toMatchObject({ code: 'PT_INPUT_INVALID' })
    expect(
      classifyPdfError(new Error('Input document to `PDFDocument.load` is encrypted'))
    ).toMatchObject({ code: 'PT_PDF_ENCRYPTED' })
    expect(classifyPdfError(new Error('invalid pdf'))).toMatchObject({ code: 'PT_PDF_CORRUPT' })
    expect(classifyPdfError('plain string')).toMatchObject({ code: 'PT_PDF_CORRUPT' })
    expect(classifyPdfError(new Error(''))).toMatchObject({ code: 'PT_PDF_CORRUPT' })
    const structured = toolError('PT_NO_PAGES_LEFT')
    expect(classifyPdfError(structured)).toBe(structured)
  })

  it('createNodeDeps 暴露运行器与预检', () => {
    const deps = createNodeDeps()
    expect(typeof deps.run).toBe('function')
    expect(typeof deps.inspect).toBe('function')
    expect(typeof deps.checkReadable).toBe('function')
    expect(typeof deps.checkExclusive).toBe('function')
  })

  it('registerMain 注册 info + 八个任务通道', () => {
    const { ctx, harness } = makeCtx()
    registerMain(ctx)
    expect([...harness.ipc.keys()]).toEqual(['info'])
    expect([...harness.tasks.keys()]).toEqual([
      'merge',
      'split',
      'delete',
      'rotate',
      'reorder',
      'metadata',
      'watermark',
      'page-numbers'
    ])
  })
})
