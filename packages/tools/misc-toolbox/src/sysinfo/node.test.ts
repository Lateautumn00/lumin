/**
 * @file node.test.ts 单通道注册单测（假 ctx + 假 deps）
 * @author cuilanchao
 * @date 2026-11-22
 */
import { describe, expect, it } from 'vitest'
import type { IpcHandler, MainPluginContext } from '@lumin/plugin-api'
import { manifest } from '../manifest'
import { type SystemInfoDeps } from './collect'
import { toolError } from './errors'
import { registerWith } from './node'

function fakeDeps(overrides: Partial<SystemInfoDeps> = {}): SystemInfoDeps {
  return {
    cpus: () => [{ model: 'Test CPU', speed: 3000 }],
    totalmem: () => 8 * 1024 ** 3,
    freemem: () => 2 * 1024 ** 3,
    platform: () => 'win32',
    type: () => 'Windows_NT',
    release: () => '10.0.22631',
    version: () => 'Windows 11',
    arch: () => 'x64',
    hostname: () => 'lumin-test',
    uptime: () => 3600,
    networkInterfaces: () => ({}),
    statfs: async () => ({ bsize: 4096, blocks: 100, bfree: 50 }),
    now: () => 1_700_000_000_000,
    drivePaths: ['C:\\'],
    ...overrides
  }
}

interface Harness {
  ctx: MainPluginContext
  ipc: Map<string, IpcHandler<unknown, unknown>>
}

function createHarness(deps: SystemInfoDeps): Harness {
  const ipc = new Map<string, IpcHandler<unknown, unknown>>()
  const ctx: MainPluginContext = {
    toolId: manifest.id,
    manifest,
    registerIpc: (action, handler) => {
      ipc.set(action, handler as IpcHandler<unknown, unknown>)
    },
    registerTask: () => undefined,
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
    paths: { temp: '', userData: '', binaries: '' }
  }
  registerWith(ctx, deps)
  return { ctx, ipc }
}

function invoke(harness: Harness): Promise<unknown> {
  const handler = harness.ipc.get('snapshot')
  if (handler === undefined) throw new Error('缺少 snapshot 通道')
  return Promise.resolve(handler({ toolId: manifest.id, action: 'snapshot', payload: {} }))
}

describe('registerWith', () => {
  it('注册 snapshot 通道并返回校验后的快照', async () => {
    const harness = createHarness(fakeDeps())
    expect(harness.ipc.has('snapshot')).toBe(true)
    await expect(invoke(harness)).resolves.toMatchObject({
      collectedAt: 1_700_000_000_000,
      cpu: { model: 'Test CPU', cores: 1, speedMhz: 3000 },
      disks: [{ path: 'C:\\' }]
    })
  })

  it('普通异常包装为 SI_COLLECT_FAILED 并保留消息', async () => {
    const harness = createHarness(
      fakeDeps({
        cpus: () => {
          throw new Error('boom')
        }
      })
    )
    await expect(invoke(harness)).rejects.toEqual({
      code: 'SI_COLLECT_FAILED',
      message: '采集系统信息失败',
      detail: 'boom'
    })
  })

  it('结构化错误原样透传', async () => {
    const structured = toolError('SI_COLLECT_FAILED', 'custom')
    const harness = createHarness(
      fakeDeps({
        cpus: () => {
          throw structured
        }
      })
    )
    await expect(invoke(harness)).rejects.toEqual(structured)
  })
})
