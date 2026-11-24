/**
 * @file client.test.ts renderer invoke 封装单测（断言通道名与入参，7 通道）
 * @author cuilanchao
 * @date 2026-11-24
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearHistory,
  copyImage,
  deleteEntry,
  loadImage,
  loadList,
  loadPoll,
  togglePin
} from './client'

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

  it('loadImage 走 clipboard-history:image 且携带 id', async () => {
    invoke.mockResolvedValue({ dataUrl: 'data:image/png;base64,AA' })
    expect(await loadImage('img-9')).toEqual({ dataUrl: 'data:image/png;base64,AA' })
    expect(invoke).toHaveBeenCalledWith('clipboard-history:image', { id: 'img-9' })
  })

  it('copyImage 走 clipboard-history:copy 且携带 id', async () => {
    await copyImage('img-9')
    expect(invoke).toHaveBeenCalledWith('clipboard-history:copy', { id: 'img-9' })
  })
})
