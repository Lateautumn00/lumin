import { describe, expect, it } from 'vitest'
import { createMutex } from './mutex'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createMutex', () => {
  it('空闲时 acquire 立即获得，release 后归还', async () => {
    const mutex = createMutex()
    expect(mutex.locked).toBe(false)
    await mutex.acquire()
    expect(mutex.locked).toBe(true)
    mutex.release()
    expect(mutex.locked).toBe(false)
  })

  it('重复 release 不产生负锁', () => {
    const mutex = createMutex()
    mutex.release()
    mutex.release()
    expect(mutex.locked).toBe(false)
  })

  it('持锁期间第二请求等待，release 后交接（FIFO）', async () => {
    const mutex = createMutex()
    await mutex.acquire()

    const order: number[] = []
    const p1 = mutex.acquire().then(() => order.push(1))
    const p2 = mutex.acquire().then(() => order.push(2))
    await tick()
    expect(order).toEqual([])

    mutex.release() // 交接给 p1
    await p1
    expect(order).toEqual([1])
    expect(mutex.locked).toBe(true)

    mutex.release() // 交接给 p2
    await p2
    expect(order).toEqual([1, 2])

    mutex.release()
    expect(mutex.locked).toBe(false)
  })

  it('等锁期间 abort → 拒绝且不占队列位', async () => {
    const mutex = createMutex()
    await mutex.acquire()

    const controller = new AbortController()
    const waiting = mutex.acquire(controller.signal)
    controller.abort()
    await expect(waiting).rejects.toThrow('aborted')

    // 队列已清空：后续 acquire 正常交接
    const next = mutex.acquire()
    mutex.release()
    await next
    expect(mutex.locked).toBe(true)
    mutex.release()
  })

  it('acquire 时信号已中止 → 立即拒绝', async () => {
    const mutex = createMutex()
    const controller = new AbortController()
    controller.abort()
    await expect(mutex.acquire(controller.signal)).rejects.toThrow('aborted')
    expect(mutex.locked).toBe(false)
  })

  it('多个等待者按 FIFO 依次获得', async () => {
    const mutex = createMutex()
    await mutex.acquire()
    const order: string[] = []
    const waiters = ['a', 'b', 'c'].map((name) =>
      mutex.acquire().then(() => {
        order.push(name)
      })
    )
    mutex.release()
    await waiters[0]
    mutex.release()
    await waiters[1]
    mutex.release()
    await waiters[2]
    mutex.release()
    expect(order).toEqual(['a', 'b', 'c'])
  })
})

describe('sofficeMutex 单例', () => {
  it('同一模块实例（跨工具共享）', async () => {
    const a = await import('./mutex')
    const b = await import('./mutex')
    expect(a.sofficeMutex).toBe(b.sofficeMutex)
  })
})
