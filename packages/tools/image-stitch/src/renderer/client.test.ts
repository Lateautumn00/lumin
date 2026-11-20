/**
 * @file client.test.ts renderer 通道封装单测（断言通道名与载荷透传）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelTask,
  config,
  getPathForFile,
  pickDirectory,
  revealPath,
  setOutputDir,
  submitStitch
} from './client'

const invoke = vi.fn()
const revealPathMock = vi.fn()
const pickDirectoryMock = vi.fn()
const getPathForFileMock = vi.fn()

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({})
  revealPathMock.mockReset().mockResolvedValue(undefined)
  pickDirectoryMock.mockReset().mockResolvedValue(null)
  getPathForFileMock.mockReset().mockReturnValue('C:\\imgs\\a.png')
  vi.stubGlobal('window', {
    lumin: {
      invoke,
      revealPath: revealPathMock,
      pickDirectory: pickDirectoryMock,
      getPathForFile: getPathForFileMock
    }
  })
})

describe('client 通道', () => {
  it('submitStitch → image-stitch:stitch 透传载荷', async () => {
    const payload = {
      inputPaths: ['C:\\imgs\\a.png'],
      layout: {
        mode: 'vertical' as const,
        sizeMode: 'first' as const,
        fixedSize: 2000,
        columns: 3,
        gutter: 12,
        padding: 0
      },
      encoder: 'png' as const,
      quality: 90,
      bgColor: '#ffffff'
    }
    invoke.mockResolvedValueOnce({ taskId: 'task-1' })
    await expect(submitStitch(payload)).resolves.toEqual({ taskId: 'task-1' })
    expect(invoke).toHaveBeenCalledWith('image-stitch:stitch', payload)
  })

  it('config / setOutputDir 走同步通道', async () => {
    await config()
    expect(invoke).toHaveBeenLastCalledWith('image-stitch:config', {})
    await setOutputDir({ outputDir: 'D:\\out' })
    expect(invoke).toHaveBeenLastCalledWith('image-stitch:set-output-dir', {
      outputDir: 'D:\\out'
    })
  })

  it('cancelTask 复用壳取消通道', async () => {
    await cancelTask('task-9')
    expect(invoke).toHaveBeenCalledWith('lumin:task:cancel', { taskId: 'task-9' })
  })

  it('revealPath / pickDirectory / getPathForFile 委托 bridge', async () => {
    await revealPath('D:\\out\\a.png')
    expect(revealPathMock).toHaveBeenCalledWith('D:\\out\\a.png')
    await pickDirectory('选择输出目录')
    expect(pickDirectoryMock).toHaveBeenCalledWith('选择输出目录')
    const file = new File(['x'], 'a.png')
    expect(getPathForFile(file)).toBe('C:\\imgs\\a.png')
    expect(getPathForFileMock).toHaveBeenCalledWith(file)
  })
})
