/**
 * @file client.ts 单测（断言通道名与载荷透传）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { captureDisplay } from './client'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({})
  vi.stubGlobal('window', { lumin: { invoke } })
})

describe('captureDisplay', () => {
  it('缺省显示器 → color-toolbox:capture-display + 空对象', async () => {
    await captureDisplay({})
    expect(invoke).toHaveBeenCalledWith('color-toolbox:capture-display', {})
  })

  it('指定显示器时透传 displayId', async () => {
    invoke.mockResolvedValueOnce({ displayId: '2' })
    await expect(captureDisplay({ displayId: '2' })).resolves.toEqual({ displayId: '2' })
    expect(invoke).toHaveBeenCalledWith('color-toolbox:capture-display', { displayId: '2' })
  })
})
