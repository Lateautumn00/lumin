/**
 * @file client.test.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description renderer 类型化 invoke 封装单测（断言通道名与 payload 形状）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelTask, fetchStatus, submitCleanup, submitPrepare, submitShow } from './client'

const invoke = vi.fn(async () => ({ ok: true }))

beforeEach(() => {
  invoke.mockClear()
  vi.stubGlobal('window', { lumin: { invoke } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchStatus', () => {
  it('不传路径时发送空对象', async () => {
    await fetchStatus()
    expect(invoke).toHaveBeenCalledWith('print:status', {})
  })

  it('传路径时随请求保存', async () => {
    await fetchStatus('C:\\LO\\soffice.com')
    expect(invoke).toHaveBeenCalledWith('print:status', {
      customPath: 'C:\\LO\\soffice.com'
    })
  })
})

describe('submitPrepare / submitShow', () => {
  it('prepare 透传路径数组', async () => {
    await submitPrepare(['C:\\a.pdf', 'C:\\b.png'])
    expect(invoke).toHaveBeenCalledWith('print:prepare', {
      inputPaths: ['C:\\a.pdf', 'C:\\b.png']
    })
  })

  it('show 透传 jobId', async () => {
    await submitShow('j-abc12345')
    expect(invoke).toHaveBeenCalledWith('print:show', { jobId: 'j-abc12345' })
  })
})

describe('submitCleanup / cancelTask', () => {
  it('cleanup 可清空全部或指定 job', async () => {
    await submitCleanup()
    expect(invoke).toHaveBeenCalledWith('print:cleanup', {})
    await submitCleanup(['j-abc12345'])
    expect(invoke).toHaveBeenCalledWith('print:cleanup', { jobIds: ['j-abc12345'] })
  })

  it('cancelTask 走壳通道', async () => {
    await cancelTask('task-1')
    expect(invoke).toHaveBeenCalledWith('lumin:task:cancel', { taskId: 'task-1' })
  })
})
