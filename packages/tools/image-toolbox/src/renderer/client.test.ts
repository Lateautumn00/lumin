/**
 * @file client.ts 单测（stub window.lumin bridge，断言通道名与负载透传）
 * @author cuilanchao
 * @date 2026-11-18
 * @description renderer 只经 window.lumin 白名单 bridge 调用（AGENTS §6）；
 *              锁定 probe/process/config 通道拼写与 revealPath 壳通道复用
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { config, makeGif, process, probe, revealPath, saveOutputDir } from './client'

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
  it('probe sync：通道名与负载透传', async () => {
    stubBridge()
    await expect(probe({ files: ['C:\\a.jpg'] })).resolves.toEqual({ echoed: true })
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('image-toolbox:probe', { files: ['C:\\a.jpg'] })
  })

  it('process 长任务：通道名与负载透传', async () => {
    stubBridge()
    const payload = {
      mode: 'compress' as const,
      files: ['C:\\a.jpg'],
      outputDir: 'E:\\out',
      options: { quality: 75, target: 'original' as const }
    }
    await expect(process(payload)).resolves.toEqual({ echoed: true })
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('image-toolbox:process', payload)
  })

  it('make-gif 长任务（M40）：通道名与负载透传', async () => {
    stubBridge()
    const payload = {
      files: ['C:\\a.png', 'C:\\b.png'],
      outputDir: 'E:\\out',
      options: { durationMs: 500, loop: 0, width: 320 }
    }
    await expect(makeGif(payload)).resolves.toEqual({ echoed: true })
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('image-toolbox:make-gif', payload)
  })

  it('config sync：空负载', async () => {
    stubBridge()
    await expect(config()).resolves.toEqual({ echoed: true })
    expect(invoke).toHaveBeenCalledWith('image-toolbox:config', {})
  })

  it('saveOutputDir sync：目录记忆落盘', async () => {
    stubBridge()
    await expect(saveOutputDir('E:\\out')).resolves.toEqual({ echoed: true })
    expect(invoke).toHaveBeenCalledWith('image-toolbox:set-output-dir', { outputDir: 'E:\\out' })
  })

  it('revealPath 复用壳通道', async () => {
    stubBridge()
    await expect(revealPath('E:\\out\\a.jpg')).resolves.toBeUndefined()
    expect(reveal).toHaveBeenCalledOnce()
    expect(reveal).toHaveBeenCalledWith('E:\\out\\a.jpg')
  })
})
