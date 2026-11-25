/**
 * @file node.test.ts file-scanner 注册入口单测（断言三页签 9 通道齐备）
 * @author cuilanchao
 * @date 2026-11-25
 */
import type { MainPluginContext } from '@lumin/plugin-api'
import { describe, expect, it } from 'vitest'
import { manifest } from './manifest'
import { registerAll, registerMain } from './node'

/** 构造只记录通道名的插件上下文 */
function createStubContext(): { ctx: MainPluginContext; ipc: string[]; tasks: string[] } {
  const ipc: string[] = []
  const tasks: string[] = []
  const ctx = {
    toolId: manifest.id,
    manifest,
    registerIpc: (action: string) => ipc.push(action),
    registerTask: (action: string) => tasks.push(action),
    settings: { get: async (_key: string, fallback: never) => fallback, set: async () => undefined },
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    paths: { temp: '', userData: '', binaries: '' }
  } as unknown as MainPluginContext
  return { ctx, ipc, tasks }
}

describe('file-scanner 注册入口', () => {
  it('registerAll 注册 6 个同步通道与 3 个任务通道', () => {
    const { ctx, ipc, tasks } = createStubContext()
    registerAll(ctx)
    expect(ipc).toEqual([
      'hash-config',
      'hash-set-config',
      'dup-config',
      'dup-set-config',
      'compare-config',
      'compare-set-config'
    ])
    expect(tasks).toEqual(['hash', 'dup-scan', 'compare'])
  })

  it('registerMain 复用同一注册表（壳侧入口）', () => {
    const { ctx, ipc, tasks } = createStubContext()
    registerMain(ctx)
    expect(ipc).toHaveLength(6)
    expect(tasks).toHaveLength(3)
  })
})
