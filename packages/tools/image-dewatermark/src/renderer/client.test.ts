/**
 * @file client.test.ts renderer 类型化 invoke 封装单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 断言通道名与入参形状（不启动 Electron，mock window.lumin）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DewatermarkPayload } from '../schema'
import {
  cancelTask,
  config,
  getPathForFile,
  pickDirectory,
  revealPath,
  setOutputDir,
  submitDewatermark
} from './client'

const invoke = vi.fn()
const reveal = vi.fn()
const pick = vi.fn(() => Promise.resolve('D:\\out'))
const pathForFile = vi.fn(() => 'D:\\imgs\\a.png')

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ outputDir: 'D:\\out' })
  reveal.mockReset()
  vi.stubGlobal('window', {
    lumin: {
      invoke,
      revealPath: reveal,
      pickDirectory: pick,
      getPathForFile: pathForFile
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const payload: DewatermarkPayload = {
  inputPath: 'D:\\imgs\\a.png',
  regions: [{ x: 1, y: 2, width: 3, height: 4 }],
  mode: 'inpaint',
  blurRadius: 12,
  outputDir: 'D:\\out'
}

describe('renderer client', () => {
  it('提交任务使用 dewatermark 通道并透传入参', async () => {
    invoke.mockResolvedValueOnce({ taskId: 'task-1' })
    await expect(submitDewatermark(payload)).resolves.toEqual({ taskId: 'task-1' })
    expect(invoke).toHaveBeenCalledWith('image-dewatermark:dewatermark', payload)
  })

  it('config / set-output-dir 同步通道', async () => {
    await config()
    expect(invoke).toHaveBeenCalledWith('image-dewatermark:config', {})
    await setOutputDir({ outputDir: 'D:\\out' })
    expect(invoke).toHaveBeenCalledWith('image-dewatermark:set-output-dir', {
      outputDir: 'D:\\out'
    })
  })

  it('取消任务走壳通道', async () => {
    invoke.mockResolvedValueOnce(undefined)
    await cancelTask('task-9')
    expect(invoke).toHaveBeenCalledWith('lumin:task:cancel', { taskId: 'task-9' })
  })

  it('打开目录 / 选择目录 / 文件路径均经 bridge', async () => {
    await revealPath('D:\\out\\a.png')
    expect(reveal).toHaveBeenCalledWith('D:\\out\\a.png')
    await expect(pickDirectory('选择目录')).resolves.toBe('D:\\out')
    expect(pick).toHaveBeenCalledWith('选择目录')
    const file = new File(['x'], 'a.png')
    expect(getPathForFile(file)).toBe('D:\\imgs\\a.png')
    expect(pathForFile).toHaveBeenCalledWith(file)
  })
})
