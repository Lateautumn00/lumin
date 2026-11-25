/**
 * @file client.test.ts renderer 通道封装单测（stub window.lumin）
 * @author cuilanchao
 * @date 2026-11-21
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { config, emptyDirs, setConfig, tempClean, touch, tree } from './client'

interface Call {
  channel: string
  payload: unknown
}

function stubBridge(): Call[] {
  const calls: Call[] = []
  const invoke = vi.fn(async (channel: string, payload?: unknown) => {
    calls.push({ channel, payload })
    return channel.endsWith(':config') || channel.endsWith(':set-config')
      ? { lastRoot: null, treeDepth: 3, treeExclude: [], tempExtensions: [] }
      : { taskId: 'task-1' }
  })
  vi.stubGlobal('window', { lumin: { invoke } })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('client', () => {
  it('tree 使用 fs-cleaner:tree 通道', async () => {
    const calls = stubBridge()
    const result = await tree({ root: 'C:\\a', maxDepth: 3, exclude: [] })
    expect(result.taskId).toBe('task-1')
    expect(calls[0]?.channel).toBe('file-scanner:clean-tree')
  })

  it('emptyDirs 使用 fs-cleaner:empty-dirs 通道', async () => {
    const calls = stubBridge()
    await emptyDirs({ root: 'C:\\a' })
    expect(calls[0]?.channel).toBe('file-scanner:clean-empty-dirs')
  })

  it('touch 透传 dryRun', async () => {
    const calls = stubBridge()
    await touch({
      root: 'C:\\a',
      recursive: true,
      extensions: [],
      mtimeMs: 0,
      dryRun: true
    })
    expect(calls[0]?.payload).toMatchObject({ dryRun: true })
  })

  it('tempClean 使用 fs-cleaner:temp-clean 通道', async () => {
    const calls = stubBridge()
    await tempClean({ root: 'C:\\a', recursive: true, extensions: ['log'] })
    expect(calls[0]?.channel).toBe('file-scanner:clean-temp-clean')
  })

  it('config 与 setConfig 走同步通道', async () => {
    const calls = stubBridge()
    await config()
    await setConfig({ treeDepth: 3, treeExclude: [], tempExtensions: [] })
    expect(calls.map((call) => call.channel)).toEqual([
      'file-scanner:clean-config',
      'file-scanner:clean-set-config'
    ])
  })
})
