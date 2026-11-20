/**
 * @file client.test.ts renderer invoke 封装单测（断言通道名与入参）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compare, config, setConfig } from './client'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ taskId: 'task-1' })
  vi.stubGlobal('window', { lumin: { invoke } })
})

describe('client', () => {
  it('compare 走 folder-compare:compare 并透传 payload', async () => {
    const payload = { leftRoot: 'C:\\a', rightRoot: 'D:\\b', compareMtime: true }
    await expect(compare(payload)).resolves.toEqual({ taskId: 'task-1' })
    expect(invoke).toHaveBeenCalledWith('folder-compare:compare', payload)
  })

  it('config / set-config 通道名正确', async () => {
    await config()
    expect(invoke).toHaveBeenCalledWith('folder-compare:config', {})

    await setConfig({ leftRoot: 'C:\\a', rightRoot: '', compareMtime: false })
    expect(invoke).toHaveBeenCalledWith('folder-compare:set-config', {
      leftRoot: 'C:\\a',
      rightRoot: '',
      compareMtime: false
    })
  })
})
