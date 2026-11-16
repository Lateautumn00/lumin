import { parentPort, Worker } from 'node:worker_threads'
import {
  isStructuredError,
  makeError,
  taskUpdateSchema,
  toStructuredError,
  type StructuredError,
  type TaskUpdate
} from '@lumin/shared'

/** main → worker 启动消息（协议唯一首条） */
interface StartMessage {
  kind: 'start'
  payload: unknown
}

/** worker → main 完成消息 */
interface DoneMessage {
  kind: 'done'
  value: unknown
}

/** worker → main 失败消息（结构化错误；Error 实例禁止透传，由 exposeTask 归一） */
interface ErrorMessage {
  kind: 'error'
  error: StructuredError
}

export interface RunTaskOptions<P> {
  /** worker 文件绝对路径（electron-vite `?modulePath` 构建产物） */
  workerPath: string
  /** 任务入参（须可结构化克隆） */
  payload: P
  /** 超时（自 worker 启动起计）；超时 terminate 并抛 TaskTimeoutError */
  timeoutMs?: number
  /** 外部取消（任务队列 abort）；触发后 terminate 并以 CANCELLED 拒绝 */
  signal?: AbortSignal
  /** worker 进度/日志回调（progress | log） */
  onUpdate?: (update: TaskUpdate) => void
}

export class TaskTimeoutError extends Error {
  override readonly name = 'TaskTimeoutError'
  constructor(readonly timeoutMs: number) {
    super(`任务执行超时（${timeoutMs}ms）`)
  }
}

export class TaskCrashError extends Error {
  override readonly name = 'TaskCrashError'
  constructor(
    message: string,
    override readonly cause?: unknown
  ) {
    super(message)
  }
}

function kindOf(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null || !('kind' in raw)) return ''
  const kind: unknown = (raw as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : ''
}

/**
 * 在给定端口上注册 worker 侧任务处理（协议：start → progress|log* → done|error）。
 * 端口为 `parentPort`（生产）或测试用 MessagePort；`exposeTask` 的薄封装。
 */
export function attachTaskHandler<P, R>(
  port: Pick<TaskPort, 'once' | 'postMessage'>,
  handler: (payload: P, ctx: TaskRunContext) => Promise<R>
): void {
  port.once('message', (raw: unknown) => {
    if (kindOf(raw) !== 'start' || !('payload' in (raw as object))) {
      const error: ErrorMessage = {
        kind: 'error',
        error: makeError('INVALID_PAYLOAD', 'worker 启动消息非法')
      }
      port.postMessage(error)
      return
    }
    const payload = (raw as StartMessage).payload as P
    void (async () => {
      try {
        const value = await handler(payload, {
          emit: (update) => port.postMessage(update)
        })
        const done: DoneMessage = { kind: 'done', value }
        port.postMessage(done)
      } catch (err) {
        const failure: ErrorMessage = {
          kind: 'error',
          error: isStructuredError(err) ? err : toStructuredError(err)
        }
        port.postMessage(failure)
      }
    })()
  })
}

export interface TaskRunContext {
  /** 推送 progress/log 更新到主进程 */
  emit: (update: TaskUpdate) => void
}

/** worker 端口的最小形状（`parentPort` 结构兼容；测试可注入 MessagePort） */
export interface TaskPort {
  once(event: 'message', listener: (raw: unknown) => void): unknown
  postMessage(value: unknown): void
}

/**
 * worker 侧入口：注册任务处理器。
 * 非 worker 环境（`parentPort` 为 null，如工具模块被测试直接 import）直接返回，杜绝副作用。
 */
export function exposeTask<P, R>(handler: (payload: P, ctx: TaskRunContext) => Promise<R>): void {
  const port = parentPort
  if (port === null) return
  attachTaskHandler(port, handler)
}

/**
 * 主进程侧：启动 worker 执行单次任务。
 * 成功以 done 值 resolve；worker 上报的结构化错误原样 reject；
 * 超时/崩溃/协议违规分别抛 TaskTimeoutError / TaskCrashError（由调用方映射工具错误码）；
 * 取消以 CANCELLED 结构化错误 reject（任务队列按 aborted 状态归一）。
 * 任何终态均 terminate worker（硬终止，杜绝线程泄漏）。
 */
export function runTask<P, R = unknown>(options: RunTaskOptions<P>): Promise<R> {
  const { workerPath, payload, timeoutMs, signal, onUpdate } = options

  return new Promise<R>((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeError('CANCELLED', '任务已取消'))
      return
    }

    const worker = new Worker(workerPath, {})
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    const settleResolve = (value: R): void => {
      if (settled) return
      settled = true
      cleanup()
      void worker.terminate()
      resolve(value)
    }

    const settleReject = (err: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      void worker.terminate()
      reject(err)
    }

    function onAbort(): void {
      settleReject(makeError('CANCELLED', '任务已取消'))
    }

    if (timeoutMs !== undefined) {
      timer = setTimeout(() => settleReject(new TaskTimeoutError(timeoutMs)), timeoutMs)
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    worker.on('message', (raw: unknown) => {
      if (settled) return
      const kind = kindOf(raw)
      if (kind === 'progress' || kind === 'log') {
        const parsed = taskUpdateSchema.safeParse(raw)
        if (parsed.success) {
          onUpdate?.(parsed.data)
          return
        }
      } else if (kind === 'done') {
        settleResolve((raw as DoneMessage).value as R)
        return
      } else if (kind === 'error') {
        const error = (raw as ErrorMessage).error
        settleReject(
          isStructuredError(error) ? error : new TaskCrashError('worker 错误消息非结构化')
        )
        return
      }
      settleReject(new TaskCrashError('worker 发送了非法协议消息'))
    })

    worker.on('error', (err) => {
      settleReject(new TaskCrashError('worker 执行异常', err))
    })

    worker.on('exit', (code) => {
      settleReject(new TaskCrashError(`worker 异常退出（code=${code}）`))
    })

    try {
      const start: StartMessage = { kind: 'start', payload }
      worker.postMessage(start)
    } catch (err) {
      settleReject(new TaskCrashError('任务入参无法传递给 worker', err))
    }
  })
}
