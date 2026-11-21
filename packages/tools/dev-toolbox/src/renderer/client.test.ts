/**
 * @file renderer/client.ts 单测：七通道名与入参透传（stub window.lumin）
 * @author cuilanchao
 * @date 2026-11-21
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  config,
  portKill,
  portsQuery,
  serverStart,
  serverStatus,
  serverStop,
  setConfig
} from './client'

interface Call {
  channel: string
  payload: unknown
}

function stubBridge(): Call[] {
  const calls: Call[] = []
  const invoke = vi.fn(async (channel: string, payload?: unknown) => {
    calls.push({ channel, payload })
    return {}
  })
  vi.stubGlobal('window', { lumin: { invoke } })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('client', () => {
  it('ports-query 透传端口条件', async () => {
    const calls = stubBridge()
    await portsQuery({ port: 8080 })
    expect(calls).toEqual([{ channel: 'dev-toolbox:ports-query', payload: { port: 8080 } }])
  })

  it('port-kill 包装为 { pid }', async () => {
    const calls = stubBridge()
    await portKill(42)
    expect(calls).toEqual([{ channel: 'dev-toolbox:port-kill', payload: { pid: 42 } }])
  })

  it('server-start 透传根目录与端口', async () => {
    const calls = stubBridge()
    await serverStart({ root: 'C:\\site', port: 8080 })
    expect(calls).toEqual([
      { channel: 'dev-toolbox:server-start', payload: { root: 'C:\\site', port: 8080 } }
    ])
  })

  it('server-stop / server-status 发送空对象', async () => {
    const calls = stubBridge()
    await serverStop()
    await serverStatus()
    expect(calls).toEqual([
      { channel: 'dev-toolbox:server-stop', payload: {} },
      { channel: 'dev-toolbox:server-status', payload: {} }
    ])
  })

  it('config / set-config 透传', async () => {
    const calls = stubBridge()
    await config()
    await setConfig({ port: 3000 })
    expect(calls).toEqual([
      { channel: 'dev-toolbox:config', payload: {} },
      { channel: 'dev-toolbox:set-config', payload: { port: 3000 } }
    ])
  })
})
