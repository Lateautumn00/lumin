/**
 * @file client.ts 单测（stub window.lumin bridge，断言通道名与负载透传）
 * @author cuilanchao
 * @date 2026-11-20
 * @description renderer 只经 window.lumin 白名单 bridge 调用（AGENTS §6）；
 *              锁定 config/set-output-dir/process 通道拼写与 revealPath 壳通道复用
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { config, process, revealPath, saveOutputDir } from './client'

const invoke = vi.fn(async () => ({ echoed: true }))
const reveal = vi.fn(async () => undefined)

afterEach(() => {
  vi.unstubAllGlobals()
  invoke.mockClear()
  reveal.mockClear()
})

/** 注入假 bridge（node 测试环境无 window） */
function stubBridge(): void {
  vi.stubGlobal('window', { lumin: { invoke, revealPath: reveal } })
}

describe('client 通道封装（AGENTS §6 白名单 bridge）', () => {
  it('config sync：空负载', async () => {
    stubBridge()
    await expect(config()).resolves.toEqual({ echoed: true })
    expect(invoke).toHaveBeenCalledWith('image-rotate:config', {})
  })

  it('saveOutputDir sync：目录记忆落盘', async () => {
    stubBridge()
    await expect(saveOutputDir('E:\\out')).resolves.toEqual({ echoed: true })
    expect(invoke).toHaveBeenCalledWith('image-rotate:set-output-dir', { outputDir: 'E:\\out' })
  })

  it('process 长任务：通道名与负载透传', async () => {
    stubBridge()
    const payload = {
      files: ['C:\\a.png'],
      outputDir: 'E:\\out',
      options: { rotation: '90' as const, flip: 'vertical' as const }
    }
    await expect(process(payload)).resolves.toEqual({ echoed: true })
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('image-rotate:process', payload)
  })

  it('revealPath 复用壳通道', async () => {
    stubBridge()
    await expect(revealPath('E:\\out\\a.png')).resolves.toBeUndefined()
    expect(reveal).toHaveBeenCalledOnce()
    expect(reveal).toHaveBeenCalledWith('E:\\out\\a.png')
  })
})
