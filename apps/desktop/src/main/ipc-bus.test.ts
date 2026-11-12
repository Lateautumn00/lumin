import { describe, expect, it, vi } from 'vitest'
import { makeError } from '@lumin/shared'
import { createIpcBus, type IpcBus } from './ipc-bus'
import type { TaskQueue } from './task-queue'

function createBus(overrides?: { queue?: Partial<TaskQueue> }): {
  bus: IpcBus
  error: ReturnType<typeof vi.fn>
} {
  const error = vi.fn()
  const queue: TaskQueue = {
    submit: () => 'task-1',
    cancel: () => true,
    ...overrides?.queue
  }
  const bus = createIpcBus({ queue, logger: { error } })
  return { bus, error }
}

describe('createIpcBus', () => {
  it('坏信封 → INVALID_PAYLOAD', async () => {
    const { bus } = createBus()
    const expected = { ok: false, error: { code: 'INVALID_PAYLOAD', message: '请求格式无效' } }
    expect(await bus.dispatch({ channel: 'bad' })).toEqual(expected)
    expect(await bus.dispatch(null)).toEqual(expected)
    expect(await bus.dispatch('x')).toEqual(expected)
  })

  it('未注册通道 → NOT_REGISTERED', async () => {
    const { bus } = createBus()
    expect(await bus.dispatch({ channel: 'example:ping' })).toEqual({
      ok: false,
      error: { code: 'NOT_REGISTERED', message: '通道未注册：example:ping' }
    })
  })

  it('同步 handler 成功返回 data', async () => {
    const { bus } = createBus()
    bus.registerSync('example:ping', 'example', 'ping', () => ({ pong: true }))
    expect(await bus.dispatch({ channel: 'example:ping' })).toEqual({
      ok: true,
      data: { pong: true }
    })
  })

  it('同步 handler 抛 Error → INTERNAL 并记日志', async () => {
    const { bus, error } = createBus()
    bus.registerSync('example:ping', 'example', 'ping', () => {
      throw new Error('boom')
    })
    expect(await bus.dispatch({ channel: 'example:ping' })).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'boom' }
    })
    expect(error).toHaveBeenCalledOnce()
  })

  it('结构化错误透传不改写', async () => {
    const { bus } = createBus()
    bus.registerSync('example:ping', 'example', 'ping', () => {
      throw makeError('BUSY', '正忙')
    })
    expect(await bus.dispatch({ channel: 'example:ping' })).toEqual({
      ok: false,
      error: { code: 'BUSY', message: '正忙' }
    })
  })

  it('任务通道提交返回 { taskId }', async () => {
    const { bus } = createBus()
    bus.registerTask('example:sleep', 'example', 'sleep', async () => 'x')
    expect(await bus.dispatch({ channel: 'example:sleep', payload: { durationMs: 100 } })).toEqual({
      ok: true,
      data: { taskId: 'task-1' }
    })
  })

  it('队列满 → QUEUE_FULL 信封', async () => {
    const { bus } = createBus({
      queue: {
        submit: () => {
          throw makeError('QUEUE_FULL', '任务队列已满')
        }
      }
    })
    bus.registerTask('example:sleep', 'example', 'sleep', async () => 'x')
    expect(await bus.dispatch({ channel: 'example:sleep' })).toEqual({
      ok: false,
      error: { code: 'QUEUE_FULL', message: '任务队列已满' }
    })
  })

  it('非法通道名注册抛错', () => {
    const { bus } = createBus()
    expect(() => bus.registerSync('bad', 'tool', 'a', () => undefined)).toThrow('非法通道名')
    expect(() => bus.registerTask('bad', 'tool', 'a', async () => undefined)).toThrow('非法通道名')
  })
})
