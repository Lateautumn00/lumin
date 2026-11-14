import { describe, expect, it, vi } from 'vitest'
import { makeError, type TaskEvent } from '@lumin/shared'
import { createTaskQueue } from './task-queue'

function createGate(): { promise: Promise<void>; release: () => void } {
  let releaseFn: (() => void) | null = null
  const promise = new Promise<void>((resolve) => {
    releaseFn = resolve
  })
  return { promise, release: () => releaseFn?.() }
}

describe('createTaskQueue', () => {
  it('完成任务并推送 done', async () => {
    const events: TaskEvent[] = []
    const queue = createTaskQueue({ concurrency: 2, onEvent: (e) => events.push(e) })
    const taskId = queue.submit({
      toolId: 'example',
      action: 'sleep',
      payload: 21,
      handler: async ({ payload }) => ({ doubled: Number(payload) * 2 })
    })
    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events[0]).toEqual({ kind: 'done', taskId, result: { doubled: 42 } })
  })

  it('并发上限 1 时后续任务排队，前一个完成后才启动', async () => {
    const events: TaskEvent[] = []
    const started: string[] = []
    const queue = createTaskQueue({ concurrency: 1, onEvent: (e) => events.push(e) })
    const gate = createGate()

    const first = queue.submit({
      toolId: 't',
      action: 'a',
      payload: null,
      handler: async () => {
        started.push('first')
        await gate.promise
        return 'first'
      }
    })
    const second = queue.submit({
      toolId: 't',
      action: 'a',
      payload: null,
      handler: async () => {
        started.push('second')
        return 'second'
      }
    })

    expect(started).toEqual(['first'])
    gate.release()
    await vi.waitFor(() => expect(events).toHaveLength(2))
    expect(started).toEqual(['first', 'second'])
    expect(events).toEqual([
      { kind: 'done', taskId: first, result: 'first' },
      { kind: 'done', taskId: second, result: 'second' }
    ])
  })

  it('队列满时提交抛出 QUEUE_FULL', async () => {
    const queue = createTaskQueue({ concurrency: 1, maxPending: 1, onEvent: () => undefined })
    const gate = createGate()
    queue.submit({
      toolId: 't',
      action: 'a',
      payload: null,
      handler: async () => {
        await gate.promise
        return 1
      }
    })
    queue.submit({
      toolId: 't',
      action: 'a',
      payload: null,
      handler: async () => 2
    })
    let caught: unknown
    try {
      queue.submit({
        toolId: 't',
        action: 'a',
        payload: null,
        handler: async () => 3
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toEqual({ code: 'QUEUE_FULL', message: '任务队列已满' })
    gate.release()
  })

  it('取消排队中的任务：立即 CANCELLED 且不执行', async () => {
    const events: TaskEvent[] = []
    const queue = createTaskQueue({ concurrency: 1, onEvent: (e) => events.push(e) })
    const gate = createGate()
    let secondRan = false

    const first = queue.submit({
      toolId: 't',
      action: 'a',
      payload: null,
      handler: async () => {
        await gate.promise
        return 'a'
      }
    })
    const second = queue.submit({
      toolId: 't',
      action: 'a',
      payload: null,
      handler: async () => {
        secondRan = true
        return 'b'
      }
    })

    expect(queue.cancel(second)).toBe(true)
    expect(events).toEqual([
      { kind: 'error', taskId: second, error: { code: 'CANCELLED', message: '任务已取消' } }
    ])

    gate.release()
    await vi.waitFor(() => expect(events).toHaveLength(2))
    expect(secondRan).toBe(false)
    expect(events[1]).toEqual({ kind: 'done', taskId: first, result: 'a' })
  })

  it('取消运行中的任务：abort 信号 + 单次 CANCELLED', async () => {
    const events: TaskEvent[] = []
    const queue = createTaskQueue({ concurrency: 1, onEvent: (e) => events.push(e) })
    let sawAbort = false

    const taskId = queue.submit({
      toolId: 't',
      action: 'a',
      payload: null,
      handler: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              sawAbort = true
              reject(new Error('aborted'))
            },
            { once: true }
          )
        })
    })

    expect(queue.cancel(taskId)).toBe(true)
    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events[0]).toEqual({
      kind: 'error',
      taskId,
      error: { code: 'CANCELLED', message: '任务已取消' }
    })
    expect(sawAbort).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(events).toHaveLength(1)
  })

  it('转发 progress，终态后抑制 emit 与 done', async () => {
    const events: TaskEvent[] = []
    const queue = createTaskQueue({ concurrency: 1, onEvent: (e) => events.push(e) })
    const gate = createGate()

    const taskId = queue.submit({
      toolId: 't',
      action: 'a',
      payload: null,
      handler: async ({ emit, signal }) => {
        emit({ kind: 'progress', current: 1, total: 2 })
        await gate.promise
        emit({ kind: 'progress', current: 2, total: 2 })
        if (signal.aborted) throw new Error('aborted')
        return 'ok'
      }
    })

    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events[0]).toEqual({
      kind: 'progress',
      taskId,
      current: 1,
      total: 2,
      message: undefined
    })

    queue.cancel(taskId)
    expect(events).toHaveLength(2)
    gate.release()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(events).toHaveLength(2)
    expect(events[1]?.kind).toBe('error')
  })

  it('转发 progress 的 stage 阶段标记', async () => {
    const events: TaskEvent[] = []
    const queue = createTaskQueue({ concurrency: 1, onEvent: (e) => events.push(e) })
    queue.submit({
      toolId: 't',
      action: 'a',
      payload: null,
      handler: async ({ emit }) => {
        emit({ kind: 'progress', current: 0, stage: 'download', message: '下载中' })
        return null
      }
    })
    await vi.waitFor(() => expect(events.at(-1)?.kind).toBe('done'))
    expect(events[0]).toEqual({
      kind: 'progress',
      taskId: expect.any(String),
      current: 0,
      stage: 'download',
      message: '下载中'
    })
  })

  it('错误归一：Error → INTERNAL，结构化错误透传', async () => {
    const events: TaskEvent[] = []
    const queue = createTaskQueue({ concurrency: 2, onEvent: (e) => events.push(e) })

    const first = queue.submit({
      toolId: 't',
      action: 'a',
      payload: null,
      handler: async () => {
        throw new Error('boom')
      }
    })
    const second = queue.submit({
      toolId: 't',
      action: 'a',
      payload: null,
      handler: async () => {
        throw makeError('BUSY', '文件被占用')
      }
    })

    await vi.waitFor(() => expect(events).toHaveLength(2))
    expect(events).toEqual([
      { kind: 'error', taskId: first, error: { code: 'INTERNAL', message: 'boom' } },
      { kind: 'error', taskId: second, error: { code: 'BUSY', message: '文件被占用' } }
    ])
  })

  it('cancel 未知 taskId 返回 false', () => {
    const queue = createTaskQueue({ concurrency: 1, onEvent: () => undefined })
    expect(queue.cancel('nope')).toBe(false)
  })
})
