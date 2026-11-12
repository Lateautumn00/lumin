import {
  channelSchema,
  invokeRequestSchema,
  makeError,
  toStructuredError,
  type InvokeResponse
} from '@lumin/shared'
import type { IpcHandler, TaskHandler } from '@lumin/plugin-api'
import type { SubmitTaskOptions, TaskQueue } from './task-queue'

interface SyncEntry {
  kind: 'sync'
  toolId: string
  action: string
  handler: IpcHandler<unknown, unknown>
}

interface TaskEntry {
  kind: 'task'
  toolId: string
  action: string
  handler: TaskHandler<unknown, unknown>
}

type Entry = SyncEntry | TaskEntry

export interface IpcBusLogger {
  error(message: string, ...meta: unknown[]): void
}

export interface IpcBusDeps {
  queue: TaskQueue
  logger?: IpcBusLogger
}

export interface IpcBus {
  registerSync(
    channel: string,
    toolId: string,
    action: string,
    handler: IpcHandler<unknown, unknown>
  ): void
  registerTask(
    channel: string,
    toolId: string,
    action: string,
    handler: TaskHandler<unknown, unknown>
  ): void
  dispatch(raw: unknown): Promise<InvokeResponse>
}

export function createIpcBus(deps: IpcBusDeps): IpcBus {
  const registry = new Map<string, Entry>()

  const assertChannel = (channel: string): void => {
    if (!channelSchema.safeParse(channel).success) throw new Error(`非法通道名：${channel}`)
  }

  return {
    registerSync(channel, toolId, action, handler) {
      assertChannel(channel)
      registry.set(channel, { kind: 'sync', toolId, action, handler })
    },

    registerTask(channel, toolId, action, handler) {
      assertChannel(channel)
      registry.set(channel, { kind: 'task', toolId, action, handler })
    },

    async dispatch(raw) {
      const req = invokeRequestSchema.safeParse(raw)
      if (!req.success) {
        return { ok: false, error: makeError('INVALID_PAYLOAD', '请求格式无效') }
      }
      const { channel } = req.data
      const entry = registry.get(channel)
      if (!entry) {
        return { ok: false, error: makeError('NOT_REGISTERED', `通道未注册：${channel}`) }
      }
      const payload = req.data.payload
      if (entry.kind === 'sync') {
        try {
          const data = await entry.handler({ toolId: entry.toolId, action: entry.action, payload })
          return { ok: true, data }
        } catch (err) {
          deps.logger?.error(`IPC 处理失败：${channel}`, err)
          return { ok: false, error: toStructuredError(err) }
        }
      }
      const opts: SubmitTaskOptions = {
        toolId: entry.toolId,
        action: entry.action,
        payload,
        handler: entry.handler
      }
      try {
        const taskId = deps.queue.submit(opts)
        return { ok: true, data: { taskId } }
      } catch (err) {
        return { ok: false, error: toStructuredError(err) }
      }
    }
  }
}
