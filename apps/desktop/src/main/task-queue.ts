import { randomUUID } from 'node:crypto'
import { makeError, toStructuredError, type TaskEvent, type TaskUpdate } from '@lumin/shared'
import type { TaskHandler } from '@lumin/plugin-api'

export interface SubmitTaskOptions {
  toolId: string
  action: string
  payload: unknown
  handler: TaskHandler<unknown, unknown>
}

export interface TaskQueue {
  submit(opts: SubmitTaskOptions): string
  cancel(taskId: string): boolean
}

export interface TaskQueueOptions {
  concurrency: number
  maxPending?: number
  onEvent: (event: TaskEvent) => void
}

interface PendingJob {
  taskId: string
  opts: SubmitTaskOptions
}

export function createTaskQueue(options: TaskQueueOptions): TaskQueue {
  const concurrency = Math.max(1, Math.floor(options.concurrency))
  const maxPending = options.maxPending ?? 100
  const pending: PendingJob[] = []
  const running = new Map<string, AbortController>()
  const terminal = new Set<string>()

  const emitTerminal = (taskId: string, event: TaskEvent): void => {
    if (terminal.has(taskId)) return
    terminal.add(taskId)
    options.onEvent(event)
  }

  const run = async (job: PendingJob): Promise<void> => {
    const { taskId, opts } = job
    const controller = new AbortController()
    running.set(taskId, controller)

    const emit = (update: TaskUpdate): void => {
      if (terminal.has(taskId)) return
      if (update.kind === 'progress') {
        const event: TaskEvent = {
          kind: 'progress',
          taskId,
          current: update.current,
          ...(update.total !== undefined ? { total: update.total } : {}),
          ...(update.message !== undefined ? { message: update.message } : {}),
          ...(update.stage !== undefined ? { stage: update.stage } : {})
        }
        options.onEvent(event)
      } else {
        options.onEvent({ kind: 'log', taskId, message: update.message })
      }
    }

    try {
      const result = await opts.handler({
        toolId: opts.toolId,
        action: opts.action,
        payload: opts.payload,
        taskId,
        signal: controller.signal,
        emit
      })
      emitTerminal(taskId, { kind: 'done', taskId, result })
    } catch (err) {
      const error = controller.signal.aborted
        ? makeError('CANCELLED', '任务已取消')
        : toStructuredError(err)
      emitTerminal(taskId, { kind: 'error', taskId, error })
    } finally {
      running.delete(taskId)
      pump()
    }
  }

  const pump = (): void => {
    while (running.size < concurrency && pending.length > 0) {
      const job = pending.shift()
      if (!job) break
      void run(job)
    }
  }

  return {
    submit(opts) {
      if (running.size >= concurrency && pending.length >= maxPending) {
        throw makeError('QUEUE_FULL', '任务队列已满')
      }
      const taskId = randomUUID()
      pending.push({ taskId, opts })
      pump()
      return taskId
    },

    cancel(taskId) {
      const pendingIndex = pending.findIndex((job) => job.taskId === taskId)
      if (pendingIndex >= 0) {
        pending.splice(pendingIndex, 1)
        emitTerminal(taskId, { kind: 'error', taskId, error: makeError('CANCELLED', '任务已取消') })
        return true
      }
      const controller = running.get(taskId)
      if (controller) {
        controller.abort()
        emitTerminal(taskId, { kind: 'error', taskId, error: makeError('CANCELLED', '任务已取消') })
        return true
      }
      return false
    }
  }
}
