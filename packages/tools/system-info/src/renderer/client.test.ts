/**
 * @file client.test.ts renderer invoke 封装单测（断言通道名与入参）
 * @author cuilanchao
 * @date 2026-11-22
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { snapshot } from './client'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({})
  vi.stubGlobal('window', { lumin: { invoke } })
})

describe('client', () => {
  it('snapshot 走 system-info:snapshot 且空入参', async () => {
    await snapshot()
    expect(invoke).toHaveBeenCalledWith('system-info:snapshot', {})
  })
})
