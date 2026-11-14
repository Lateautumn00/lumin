import { describe, expect, it, vi } from 'vitest'
import { runProcess, SpawnError } from './run-process'

const node = process.execPath

describe('runProcess', () => {
  it('正常执行：exit 0 捕获 stdout/stderr', async () => {
    const result = await runProcess({
      command: node,
      args: ['-e', "process.stdout.write('out'); process.stderr.write('err')"]
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('out')
    expect(result.stderr).toBe('err')
    expect(result.timedOut).toBe(false)
    expect(result.aborted).toBe(false)
    expect(result.truncated).toBe(false)
  })

  it('非零退出码作为结果返回（不抛错）', async () => {
    const result = await runProcess({ command: node, args: ['-e', 'process.exit(3)'] })
    expect(result.code).toBe(3)
  })

  it('spawn 失败（ENOENT）抛 SpawnError', async () => {
    await expect(
      runProcess({ command: 'lumin-no-such-binary-xyz', args: [] })
    ).rejects.toBeInstanceOf(SpawnError)
  })

  it('超时：杀进程树并置 timedOut', async () => {
    const started = Date.now()
    const result = await runProcess({
      command: node,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 500
    })
    expect(result.timedOut).toBe(true)
    expect(result.aborted).toBe(false)
    expect(result.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(10_000)
  }, 15_000)

  it('AbortSignal 取消：杀进程并置 aborted', async () => {
    const controller = new AbortController()
    const promise = runProcess({
      command: node,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 300)
    const result = await promise
    expect(result.aborted).toBe(true)
    expect(result.timedOut).toBe(false)
  }, 15_000)

  it('信号预先 aborted：不 spawn 直接返回', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await runProcess({
      command: 'lumin-no-such-binary-xyz',
      signal: controller.signal
    })
    expect(result.aborted).toBe(true)
    expect(result.code).toBeNull()
    expect(result.stdout).toBe('')
  })

  it('输出超上限截断并置 truncated（保头）', async () => {
    const result = await runProcess({
      command: node,
      args: ['-e', "process.stdout.write('x'.repeat(5000))"],
      maxOutputChars: 1000
    })
    expect(result.stdout).toHaveLength(1000)
    expect(result.truncated).toBe(true)
  })

  it('输出未超上限不截断', async () => {
    const result = await runProcess({
      command: node,
      args: ['-e', "process.stdout.write('y'.repeat(100))"],
      maxOutputChars: 1000
    })
    expect(result.stdout).toHaveLength(100)
    expect(result.truncated).toBe(false)
  })

  it('encoding gbk：按 GBK 解码且跨 chunk 字符完整', async () => {
    // 0xd6d0=中 0xcec4=文；分两次 write 并故意在多字节字符中间切开
    const result = await runProcess({
      command: node,
      args: [
        '-e',
        'process.stdout.write(Buffer.from([0xd6])); setTimeout(() => process.stdout.write(Buffer.from([0xd0, 0xce, 0xc4])), 150)'
      ],
      encoding: 'gbk'
    })
    expect(result.stdout).toBe('中文')
  }, 15_000)

  it('已满后到达的后续 chunk 直接丢弃（不追加、保持截断）', async () => {
    const result = await runProcess({
      command: node,
      args: [
        '-e',
        "process.stdout.write('x'.repeat(10)); setTimeout(() => process.stdout.write('more'), 200)"
      ],
      maxOutputChars: 10
    })
    expect(result.stdout).toBe('x'.repeat(10))
    expect(result.truncated).toBe(true)
  })

  it('非 win32 平台：进程组 kill 失败回退直接杀子进程', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    if (!descriptor) throw new Error('缺少 process.platform 描述符')
    const realKill = process.kill.bind(process)
    Object.defineProperty(process, 'platform', { ...descriptor, value: 'linux' })
    // 进程组（负 pid）模拟 ESRCH 失败，回退分支用真实 kill 杀掉子进程使 promise 结算
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid < 0) throw new Error('ESRCH: 进程组不存在')
      return realKill(pid, signal)
    })
    try {
      const result = await runProcess({
        command: node,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        timeoutMs: 500
      })
      expect(result.timedOut).toBe(true)
      expect(killSpy).toHaveBeenCalledTimes(2)
      const groupPid = killSpy.mock.calls[0]?.[0] ?? 0
      const childPid = killSpy.mock.calls[1]?.[0] ?? 0
      expect(groupPid).toBeLessThan(0)
      expect(childPid).toBe(-groupPid)
    } finally {
      killSpy.mockRestore()
      Object.defineProperty(process, 'platform', descriptor)
    }
  }, 15_000)
})
