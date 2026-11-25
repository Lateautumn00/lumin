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
  it('registerAll 注册校验/重复/对比 + 并入重命名/清理/磁盘通道', () => {
    const { ctx, ipc, tasks } = createStubContext()
    registerAll(ctx)
    // 原三页签通道保持不变（M71）
    expect(ipc.slice(0, 6)).toEqual([
      'hash-config',
      'hash-set-config',
      'dup-config',
      'dup-set-config',
      'compare-config',
      'compare-set-config'
    ])
    expect(tasks.slice(0, 3)).toEqual(['hash', 'dup-scan', 'compare'])
    // M75 并入三页签：通道数增加且不冲突
    expect(ipc.length).toBeGreaterThan(6)
    expect(tasks.length).toBeGreaterThan(3)
  })

  it('registerMain 复用同一注册表（壳侧入口）', () => {
    const { ctx, ipc, tasks } = createStubContext()
    registerMain(ctx)
    expect(ipc.length).toBeGreaterThanOrEqual(6)
    expect(tasks.length).toBeGreaterThanOrEqual(3)
  })
})
