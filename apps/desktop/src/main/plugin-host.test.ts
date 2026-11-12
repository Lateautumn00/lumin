import { describe, expect, it, vi } from 'vitest'
import type { IpcHandler, TaskHandler, ToolManifest } from '@lumin/plugin-api'
import { loadTools, type LoadToolsDeps, type ToolRegistration } from './plugin-host'
import type { IpcBus } from './ipc-bus'

const validManifest: ToolManifest = {
  id: 'demo',
  name: '演示',
  description: '',
  icon: 'wrench',
  order: 1,
  version: '0.0.1'
}

function createDeps(): {
  deps: LoadToolsDeps
  sync: Map<string, IpcHandler<unknown, unknown>>
  task: Map<string, TaskHandler<unknown, unknown>>
  error: ReturnType<typeof vi.fn>
} {
  const sync = new Map<string, IpcHandler<unknown, unknown>>()
  const task = new Map<string, TaskHandler<unknown, unknown>>()
  const error = vi.fn()
  const bus: IpcBus = {
    registerSync: (channel, _toolId, _action, handler) => {
      sync.set(channel, handler)
    },
    registerTask: (channel, _toolId, _action, handler) => {
      task.set(channel, handler)
    },
    dispatch: async () => ({ ok: true })
  }
  const deps: LoadToolsDeps = {
    bus,
    createSettings: () => ({ get: vi.fn(), set: vi.fn() }),
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error }
  }
  return { deps, sync, task, error }
}

describe('loadTools', () => {
  it('无 registerMain 的合法清单直接装载', async () => {
    const { deps } = createDeps()
    const result = await loadTools([{ manifest: validManifest }], deps)
    expect(result.loaded).toEqual([validManifest])
    expect(result.failed).toEqual([])
  })

  it('清单不合法 → failed', async () => {
    const { deps } = createDeps()
    const bad: ToolManifest = { ...validManifest, id: 'Bad_ID' }
    const result = await loadTools([{ manifest: bad }], deps)
    expect(result.loaded).toEqual([])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.id).toBe('unknown')
  })

  it('registerMain 抛错 → failed 并记日志', async () => {
    const { deps, error } = createDeps()
    const reg: ToolRegistration = {
      manifest: validManifest,
      registerMain: () => {
        throw new Error('装载失败')
      }
    }
    const result = await loadTools([reg], deps)
    expect(result.loaded).toEqual([])
    expect(result.failed).toEqual([{ id: 'demo', message: '装载失败' }])
    expect(error).toHaveBeenCalledOnce()
  })

  it('registerIpc/registerTask 生成 {toolId}:{action} 通道', async () => {
    const { deps, sync, task } = createDeps()
    const reg: ToolRegistration = {
      manifest: validManifest,
      registerMain: (ctx) => {
        ctx.registerIpc('go', () => 'ok')
        ctx.registerTask('work', async () => 'done')
      }
    }
    const result = await loadTools([reg], deps)
    expect(result.loaded).toEqual([validManifest])
    expect(sync.has('demo:go')).toBe(true)
    expect(task.has('demo:work')).toBe(true)
  })

  it('非法 action（含大写）→ failed', async () => {
    const { deps } = createDeps()
    const reg: ToolRegistration = {
      manifest: validManifest,
      registerMain: (ctx) => {
        ctx.registerIpc('BadAction', () => 1)
      }
    }
    const result = await loadTools([reg], deps)
    expect(result.loaded).toEqual([])
    expect(result.failed[0]?.id).toBe('demo')
    expect(result.failed[0]?.message).toContain('非法 action')
  })
})
