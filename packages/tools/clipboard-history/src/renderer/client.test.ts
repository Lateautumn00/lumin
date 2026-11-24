/**
 * @file client.test.ts renderer invoke 封装单测（断言通道名与入参）
 * @author cuilanchao
 * @date 2026-11-23
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearHistory, deleteEntry, loadList, loadPoll, togglePin } from './client'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ ok: true })
  vi.stubGlobal('window', { lumin: { invoke } })
})

describe('client', () => {
  it('loadList 走 clipboard-history:list 且空入参', async () => {
    await loadList()
    expect(invoke).toHaveBeenCalledWith('clipboard-history:list', {})
  })

  it('loadPoll 走 clipboard-history:poll 且空入参', async () => {
    await loadPoll()
    expect(invoke).toHaveBeenCalledWith('clipboard-history:poll', {})
  })

  it('togglePin 携带 id', async () => {
    await togglePin('ch-1')
    expect(invoke).toHaveBeenCalledWith('clipboard-history:pin', { id: 'ch-1' })
  })

  it('deleteEntry 携带 id', async () => {
    await deleteEntry('ch-2')
    expect(invoke).toHaveBeenCalledWith('clipboard-history:remove', { id: 'ch-2' })
  })

  it('clearHistory 走 clipboard-history:clear 且空入参', async () => {
    await clearHistory()
    expect(invoke).toHaveBeenCalledWith('clipboard-history:clear', {})
  })
})
