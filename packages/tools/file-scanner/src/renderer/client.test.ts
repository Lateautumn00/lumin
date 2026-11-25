/**
 * @file client.test.ts renderer invoke 封装单测（断言三页签 9 个通道名与入参）
 * @author cuilanchao
 * @date 2026-11-25
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compareConfig,
  compareDirectories,
  duplicateConfig,
  hashConfig,
  hashFiles,
  scanDuplicates,
  setCompareConfig,
  setDuplicateConfig,
  setHashConfig
} from './client'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ taskId: 'task-1' })
  vi.stubGlobal('window', { lumin: { invoke } })
})

describe('client 文件校验', () => {
  it('hash 走 file-scanner:hash 并透传 payload', async () => {
    const payload = { paths: ['C:\\a.txt'], algorithms: ['sha256'] as const }
    await expect(hashFiles({ paths: [...payload.paths], algorithms: ['sha256'] })).resolves.toEqual({
      taskId: 'task-1'
    })
    expect(invoke).toHaveBeenCalledWith('file-scanner:hash', {
      paths: ['C:\\a.txt'],
      algorithms: ['sha256']
    })
  })

  it('hash-config / hash-set-config 通道名正确', async () => {
    await hashConfig()
    expect(invoke).toHaveBeenCalledWith('file-scanner:hash-config', {})

    await setHashConfig({ algorithms: ['md5', 'sha256'] })
    expect(invoke).toHaveBeenCalledWith('file-scanner:hash-set-config', {
      algorithms: ['md5', 'sha256']
    })
  })
})

describe('client 重复文件', () => {
  it('dup-scan 走 file-scanner:dup-scan 并透传 payload', async () => {
    const payload = { root: 'C:\\卷', recursive: true, minBytes: 1024 }
    await expect(scanDuplicates(payload)).resolves.toEqual({ taskId: 'task-1' })
    expect(invoke).toHaveBeenCalledWith('file-scanner:dup-scan', payload)
  })

  it('dup-config / dup-set-config 通道名正确', async () => {
    await duplicateConfig()
    expect(invoke).toHaveBeenCalledWith('file-scanner:dup-config', {})

    await setDuplicateConfig({ recursive: false, minBytes: 2048 })
    expect(invoke).toHaveBeenCalledWith('file-scanner:dup-set-config', {
      recursive: false,
      minBytes: 2048
    })
  })
})

describe('client 目录对比', () => {
  it('compare 走 file-scanner:compare 并透传 payload', async () => {
    const payload = {
      leftRoot: 'C:\\a',
      rightRoot: 'D:\\b',
      compareMtime: true,
      compareContent: false
    }
    await expect(compareDirectories(payload)).resolves.toEqual({ taskId: 'task-1' })
    expect(invoke).toHaveBeenCalledWith('file-scanner:compare', payload)
  })

  it('compare-config / compare-set-config 通道名正确', async () => {
    await compareConfig()
    expect(invoke).toHaveBeenCalledWith('file-scanner:compare-config', {})

    const payload = {
      leftRoot: 'C:\\a',
      rightRoot: '',
      compareMtime: false,
      compareContent: true
    }
    await setCompareConfig(payload)
    expect(invoke).toHaveBeenCalledWith('file-scanner:compare-set-config', payload)
  })
})
