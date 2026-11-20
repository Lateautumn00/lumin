/**
 * @file client.test.ts renderer invoke 封装单测（断言通道名与入参）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config, scan, setConfig } from './client'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ taskId: 'task-1' })
  vi.stubGlobal('window', { lumin: { invoke } })
})

describe('client', () => {
  it('scan 走 disk-analyzer:scan 并透传 payload', async () => {
    const payload = { root: 'C:\\卷', minFileBytes: 1024 }
    await expect(scan(payload)).resolves.toEqual({ taskId: 'task-1' })
    expect(invoke).toHaveBeenCalledWith('disk-analyzer:scan', payload)
  })

  it('config / set-config 通道名正确', async () => {
    await config()
    expect(invoke).toHaveBeenCalledWith('disk-analyzer:config', {})

    await setConfig({ root: 'D:\\data', minFileBytes: 102400 })
    expect(invoke).toHaveBeenCalledWith('disk-analyzer:set-config', {
      root: 'D:\\data',
      minFileBytes: 102400
    })
  })
})
