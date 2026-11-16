import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  attachTaskHandler,
  exposeTask,
  runTask,
  TaskCrashError,
  TaskTimeoutError,
  type RunTaskOptions
} from './run-task'
import type { TaskUpdate } from '@lumin/shared'

const FIXTURE = fileURLToPath(new URL('../fixtures/worker-protocol.mjs', import.meta.url))

interface FixturePayload {
  mode: 'ok' | 'error' | 'crash' | 'exit' | 'illegal' | 'bad-error' | 'hang'
  id?: number
}

function runFixture(
  payload: FixturePayload,
  options: Omit<RunTaskOptions<FixturePayload>, 'workerPath' | 'payload'> = {}
) {
  return runTask<FixturePayload, unknown>({ workerPath: FIXTURE, payload, ...options })
}

/** 等待观察端口收到 count 条消息（一次性收集，避免竞态丢消息） */
function nextMessages(port: MessagePort, count: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const seen: unknown[] = []
    const onMessage = (message: unknown): void => {
      seen.push(message)
      if (seen.length >= count) {
        port.off('message', onMessage)
        resolve(seen)
      }
    }
    port.on('message', onMessage)
  })
}

const channels: Array<{ port1: MessagePort; port2: MessagePort }> = []

function openChannel(): { port1: MessagePort; port2: MessagePort } {
  const channel = new MessageChannel()
  channels.push(channel)
  return channel
}

afterEach(() => {
  for (const { port1, port2 } of channels.splice(0)) {
    port1.close()
    port2.close()
  }
})

describe('runTask', () => {
  it('成功：进度/日志回调后以 done 值 resolve', async () => {
    const updates: TaskUpdate[] = []
    const result = await runFixture(
      { mode: 'ok', id: 7 },
      { onUpdate: (update) => updates.push(update) }
    )
    expect(result).toEqual({ echoed: { mode: 'ok', id: 7 }, ok: true })
    expect(updates).toEqual([
      { kind: 'progress', current: 1, total: 3, message: '加载', stage: 'load' },
      { kind: 'log', message: '处理 7' },
      { kind: 'progress', current: 3, total: 3 }
    ])
  })

  it('worker 上报的结构化错误原样 reject', async () => {
    await expect(runFixture({ mode: 'error' })).rejects.toEqual({
      code: 'PDF_ENCRYPTED',
      message: 'PDF 已加密，请先解除密码再操作'
    })
  })

  it('worker 未捕获异常 → TaskCrashError', async () => {
    await expect(runFixture({ mode: 'crash' })).rejects.toBeInstanceOf(TaskCrashError)
  })

  it('worker 未发 done 即退出 → TaskCrashError（含退出码）', async () => {
    await expect(runFixture({ mode: 'exit' })).rejects.toThrow('code=7')
  })

  it('非法协议消息 → TaskCrashError', async () => {
    await expect(runFixture({ mode: 'illegal' })).rejects.toThrow('非法协议消息')
  })

  it('非结构化 error 消息 → TaskCrashError', async () => {
    await expect(runFixture({ mode: 'bad-error' })).rejects.toThrow('非结构化')
  })

  it('worker 路径无效 → TaskCrashError', async () => {
    await expect(runTask({ workerPath: FIXTURE + '.missing', payload: {} })).rejects.toBeInstanceOf(
      TaskCrashError
    )
  })

  it('超时 → TaskTimeoutError 并终止 worker', async () => {
    const started = Date.now()
    await expect(runFixture({ mode: 'hang' }, { timeoutMs: 200 })).rejects.toBeInstanceOf(
      TaskTimeoutError
    )
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('执行中取消 → CANCELLED 结构化错误', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 50)
    await expect(runFixture({ mode: 'hang' }, { signal: controller.signal })).rejects.toEqual({
      code: 'CANCELLED',
      message: '任务已取消'
    })
  })

  it('提交前已取消 → 直接 CANCELLED（不启动 worker）', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      runTask({ workerPath: FIXTURE, payload: { mode: 'ok' }, signal: controller.signal })
    ).rejects.toEqual({ code: 'CANCELLED', message: '任务已取消' })
  })
})

describe('attachTaskHandler', () => {
  it('start → handler 执行 → emit 进度 + done 回包', async () => {
    const { port1, port2 } = openChannel()
    attachTaskHandler<{ id: number }, { sum: number }>(port2, async (payload, ctx) => {
      ctx.emit({ kind: 'progress', current: 1, total: 2 })
      return { sum: payload.id * 2 }
    })
    const pending = nextMessages(port1, 2)
    port1.postMessage({ kind: 'start', payload: { id: 21 } })
    const [progress, done] = await pending
    expect(progress).toEqual({ kind: 'progress', current: 1, total: 2 })
    expect(done).toEqual({ kind: 'done', value: { sum: 42 } })
  })

  it('结构化错误原样回传；Error 归一为 INTERNAL', async () => {
    const { port1, port2 } = openChannel()
    const structured = { code: 'RANGE_INVALID', message: '页码区间无效' }
    attachTaskHandler(port2, async () => {
      throw structured
    })
    const pending = nextMessages(port1, 1)
    port1.postMessage({ kind: 'start', payload: {} })
    expect((await pending)[0]).toEqual({ kind: 'error', error: structured })

    const channel2 = openChannel()
    attachTaskHandler(channel2.port2, async () => {
      throw new Error('炸了')
    })
    const pending2 = nextMessages(channel2.port1, 1)
    channel2.port1.postMessage({ kind: 'start', payload: {} })
    expect((await pending2)[0]).toEqual({
      kind: 'error',
      error: { code: 'INTERNAL', message: '炸了' }
    })
  })

  it('启动消息非法 → INVALID_PAYLOAD', async () => {
    const { port1, port2 } = openChannel()
    attachTaskHandler(port2, async () => 'never')
    const pending = nextMessages(port1, 1)
    port1.postMessage({ kind: 'other' })
    expect((await pending)[0]).toEqual({
      kind: 'error',
      error: { code: 'INVALID_PAYLOAD', message: 'worker 启动消息非法' }
    })
  })
})

describe('exposeTask', () => {
  it('非 worker 环境（parentPort 为 null）直接返回，无副作用', () => {
    expect(() => exposeTask(async () => 1)).not.toThrow()
  })
})
