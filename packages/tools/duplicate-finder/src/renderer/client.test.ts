/**
 * @file client.test.ts renderer invoke 封装单测（断言通道名与入参）
 * @author cuilanchao
 * @date 2026-11-19
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
  it('scan 走 duplicate-finder:scan 并透传 payload', async () => {
    const payload = { root: 'C:\\卷', recursive: true, minBytes: 1024 }
    await expect(scan(payload)).resolves.toEqual({ taskId: 'task-1' })
    expect(invoke).toHaveBeenCalledWith('duplicate-finder:scan', payload)
  })

  it('config / set-config 通道名正确', async () => {
    await config()
    expect(invoke).toHaveBeenCalledWith('duplicate-finder:config', {})

    await setConfig({ recursive: false, minBytes: 2048 })
    expect(invoke).toHaveBeenCalledWith('duplicate-finder:set-config', {
      recursive: false,
      minBytes: 2048
    })
  })
})
