import { describe, expect, it } from 'vitest'
import type { IpcHandler, MainPluginContext, TaskHandler } from '@lumin/plugin-api'
import type { TaskUpdate } from '@lumin/shared'
import { manifest } from './manifest'
import { registerMain } from './node'

function mustGet<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key)
  if (value === undefined) throw new Error(`缺少 handler：${String(key)}`)
  return value
}

function createHarness(): {
  ipc: Map<string, IpcHandler<unknown, unknown>>
  tasks: Map<string, TaskHandler<unknown, unknown>>
} {
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const ctx: MainPluginContext = {
    toolId: manifest.id,
    manifest,
    registerIpc: <P, R>(action: string, handler: IpcHandler<P, R>): void => {
      ipc.set(action, handler as unknown as IpcHandler<unknown, unknown>)
    },
    registerTask: <P, R>(action: string, handler: TaskHandler<P, R>): void => {
      tasks.set(action, handler as unknown as TaskHandler<unknown, unknown>)
    },
    settings: {
      get: async (_key, defaultValue) => defaultValue,
      set: async () => undefined
    },
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    paths: { temp: 'C:\\temp', userData: 'C:\\userData', binaries: 'C:\\binaries' }
  }
  registerMain(ctx)
  return { ipc, tasks }
}

describe('example registerMain', () => {
  it('注册 ping 与 sleep', () => {
    const { ipc, tasks } = createHarness()
    expect(ipc.has('ping')).toBe(true)
    expect(tasks.has('sleep')).toBe(true)
  })

  it('ping 返回 pong 与时间戳', async () => {
    const { ipc } = createHarness()
    const handler = mustGet(ipc, 'ping')
    const result = await handler({ toolId: 'example', action: 'ping', payload: undefined })
    expect(result).toEqual({ pong: true, at: expect.any(Number) })
  })

  it('sleep 正常推进并返回结果', async () => {
    const { tasks } = createHarness()
    const handler = mustGet(tasks, 'sleep')
    const updates: TaskUpdate[] = []
    const result = await handler({
      toolId: 'example',
      action: 'sleep',
      payload: { durationMs: 150 },
      taskId: 'task-1',
      signal: new AbortController().signal,
      emit: (update) => updates.push(update)
    })
    expect(result).toEqual({ slept: 150 })
    expect(updates).toHaveLength(2)
    expect(updates[0]).toEqual({ kind: 'progress', current: 1, total: 2, message: '1/2' })
    expect(updates[1]).toEqual({ kind: 'progress', current: 2, total: 2, message: '2/2' })
  })

  it('非法 payload → INVALID_PAYLOAD', async () => {
    const { tasks } = createHarness()
    const handler = mustGet(tasks, 'sleep')
    await expect(
      handler({
        toolId: 'example',
        action: 'sleep',
        payload: { durationMs: 10 },
        taskId: 't',
        signal: new AbortController().signal,
        emit: () => undefined
      })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
  })

  it('abort → 拒绝执行', async () => {
    const { tasks } = createHarness()
    const handler = mustGet(tasks, 'sleep')
    const controller = new AbortController()
    const promise = handler({
      toolId: 'example',
      action: 'sleep',
      payload: { durationMs: 1000 },
      taskId: 't',
      signal: controller.signal,
      emit: () => undefined
    })
    controller.abort()
    await expect(promise).rejects.toThrow('aborted')
  })

  it('信号已中止时立即拒绝', async () => {
    const { tasks } = createHarness()
    const handler = mustGet(tasks, 'sleep')
    const controller = new AbortController()
    controller.abort()
    await expect(
      handler({
        toolId: 'example',
        action: 'sleep',
        payload: { durationMs: 1000 },
        taskId: 't',
        signal: controller.signal,
        emit: () => undefined
      })
    ).rejects.toThrow('aborted')
  })
})
