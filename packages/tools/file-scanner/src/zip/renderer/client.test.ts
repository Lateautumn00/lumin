/**
 * @file client.test.ts renderer invoke 封装单测（断言通道名与入参）
 * @author cuilanchao
 * @date 2026-11-25
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackPayload, SetConfigPayload, UnpackPayload } from '../schema'
import { config, pack, setConfig, unpack } from './client'

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ taskId: 'task-1' })
  vi.stubGlobal('window', { lumin: { invoke } })
})

describe('client', () => {
  it('pack / unpack 走任务通道并透传 payload', async () => {
    const packPayload: PackPayload = {
      sources: ['C:\\a'],
      outputDir: 'D:\\输出',
      outputName: '包.zip'
    }
    await expect(pack(packPayload)).resolves.toEqual({ taskId: 'task-1' })
    expect(invoke).toHaveBeenCalledWith('file-scanner:zip-pack', packPayload)

    const unpackPayload: UnpackPayload = {
      archive: 'C:\\包.zip',
      targetDir: 'D:\\解压',
      conflict: 'skip'
    }
    await unpack(unpackPayload)
    expect(invoke).toHaveBeenCalledWith('file-scanner:zip-unpack', unpackPayload)
  })

  it('config / set-config 通道名正确', async () => {
    await config()
    expect(invoke).toHaveBeenCalledWith('file-scanner:zip-config', {})

    const payload: SetConfigPayload = {
      mode: 'unpack',
      packSources: [],
      outputDir: null,
      outputName: null,
      archive: 'C:\\包.zip',
      targetDir: 'D:\\解压',
      conflict: 'rename'
    }
    await setConfig(payload)
    expect(invoke).toHaveBeenCalledWith('file-scanner:zip-set-config', payload)
  })
})
