/**
 * @file client.test.ts renderer invoke 封装单测（断言通道名与入参）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config, exportCsv, scan, setConfig } from './client'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ taskId: 'task-1' })
  vi.stubGlobal('window', { lumin: { invoke } })
})

describe('client', () => {
  it('scan 走 disk-analyzer:scan 并透传 payload', async () => {
    const payload = { root: 'C:\\卷', minFileBytes: 1024 }
    await expect(scan(payload)).resolves.toEqual({ taskId: 'task-1' })
    expect(invoke).toHaveBeenCalledWith('file-scanner:disk-scan', payload)
  })

  it('config / set-config 通道名正确', async () => {
    await config()
    expect(invoke).toHaveBeenCalledWith('file-scanner:disk-config', {})

    await setConfig({ root: 'D:\\data', minFileBytes: 102400 })
    expect(invoke).toHaveBeenCalledWith('file-scanner:disk-set-config', {
      root: 'D:\\data',
      minFileBytes: 102400
    })
  })

  it('exportCsv 走 disk-analyzer:export-csv 并透传 payload', async () => {
    invoke.mockResolvedValue({ path: 'C:\\out.csv' })
    const payload = {
      root: 'C:\\卷',
      targetPath: 'C:\\out.csv',
      entries: [
        { name: 'a.txt', path: 'C:\\卷\\a.txt', kind: 'file' as const, size: 1, fileCount: 0 }
      ],
      typeStats: [{ ext: 'txt', files: 1, bytes: 1 }]
    }
    await expect(exportCsv(payload)).resolves.toEqual({ path: 'C:\\out.csv' })
    expect(invoke).toHaveBeenCalledWith('file-scanner:disk-export-csv', payload)
  })
})
