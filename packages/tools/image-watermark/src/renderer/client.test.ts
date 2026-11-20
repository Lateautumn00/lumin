/**
 * @file client.test.ts renderer bridge 封装单测（通道名与回包透传）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatermarkPayload } from '../schema'
import {
  cancelTask,
  config,
  getPathForFile,
  pickDirectory,
  revealPath,
  setOutputDir,
  submitWatermark
} from './client'

const invoke = vi.fn()
const bridgeReveal = vi.fn()
const bridgePickDirectory = vi.fn()
const bridgeGetPath = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  bridgeReveal.mockReset()
  bridgePickDirectory.mockReset()
  bridgeGetPath.mockReset()
  vi.stubGlobal('window', {
    lumin: {
      invoke,
      revealPath: bridgeReveal,
      pickDirectory: bridgePickDirectory,
      getPathForFile: bridgeGetPath
    }
  })
})

const payload: WatermarkPayload = {
  inputPaths: ['C:\\a.png'],
  watermark: {
    type: 'text',
    text: '内部资料',
    color: '#ffffff',
    sizePct: 8,
    opacity: 30,
    rotation: 0,
    position: 'bottom-right',
    marginPct: 3,
    tile: false
  }
}

describe('IPC 封装', () => {
  it('submitWatermark → image-watermark:watermark', async () => {
    invoke.mockResolvedValue({ taskId: 't1' })
    await expect(submitWatermark(payload)).resolves.toEqual({ taskId: 't1' })
    expect(invoke).toHaveBeenCalledWith('image-watermark:watermark', payload)
  })

  it('config / setOutputDir 通道与回包', async () => {
    invoke.mockResolvedValue({ outputDir: 'D:\\out' })
    await expect(config()).resolves.toEqual({ outputDir: 'D:\\out' })
    expect(invoke).toHaveBeenCalledWith('image-watermark:config', {})
    await expect(setOutputDir({ outputDir: 'D:\\out' })).resolves.toEqual({ outputDir: 'D:\\out' })
    expect(invoke).toHaveBeenCalledWith('image-watermark:set-output-dir', { outputDir: 'D:\\out' })
  })

  it('cancelTask → lumin:task:cancel', async () => {
    invoke.mockResolvedValue(undefined)
    await cancelTask('t1')
    expect(invoke).toHaveBeenCalledWith('lumin:task:cancel', { taskId: 't1' })
  })
})

describe('壳通道透传', () => {
  it('revealPath / pickDirectory / getPathForFile 委托 bridge', async () => {
    bridgeReveal.mockResolvedValue(undefined)
    bridgePickDirectory.mockResolvedValue('D:\\out')
    bridgeGetPath.mockReturnValue('C:\\a.png')
    await revealPath('D:\\out\\a.png')
    await expect(pickDirectory('选择目录')).resolves.toBe('D:\\out')
    expect(getPathForFile(new File([], 'a.png'))).toBe('C:\\a.png')
    expect(bridgeReveal).toHaveBeenCalledWith('D:\\out\\a.png')
    expect(bridgePickDirectory).toHaveBeenCalledWith('选择目录')
  })
})
