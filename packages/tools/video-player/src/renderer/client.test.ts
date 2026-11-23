import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolve } from './client'

const invoke = vi.fn()

vi.stubGlobal('window', { lumin: { invoke } })

afterEach(() => {
  invoke.mockReset()
})

describe('video-player client', () => {
  it('resolve 调用 video-player:resolve 并透传路径', async () => {
    const result = { url: 'file:///C:/a.mp4', name: 'a.mp4', size: 1, mime: 'video/mp4' }
    invoke.mockResolvedValue(result)
    await expect(resolve({ path: 'C:\\a.mp4' })).resolves.toEqual(result)
    expect(invoke).toHaveBeenCalledWith('video-player:resolve', { path: 'C:\\a.mp4' })
  })

  it('错误原样上抛', async () => {
    invoke.mockRejectedValue(new Error('boom'))
    await expect(resolve({ path: 'C:\\a.mp4' })).rejects.toThrow('boom')
  })
})
