import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolve } from './player'

const invoke = vi.fn()

vi.stubGlobal('window', { lumin: { invoke } })

afterEach(() => {
  invoke.mockReset()
})

describe('media-convert 播放页签 client', () => {
  it('resolve 调用 media-convert:player-resolve 并透传路径', async () => {
    const result = { url: 'file:///C:/a.mp4', name: 'a.mp4', size: 1, mime: 'video/mp4' }
    invoke.mockResolvedValue(result)
    await expect(resolve({ path: 'C:\\a.mp4' })).resolves.toEqual(result)
    expect(invoke).toHaveBeenCalledWith('media-convert:player-resolve', { path: 'C:\\a.mp4' })
  })

  it('错误原样上抛', async () => {
    invoke.mockRejectedValue(new Error('boom'))
    await expect(resolve({ path: 'C:\\a.mp4' })).rejects.toThrow('boom')
  })
})
