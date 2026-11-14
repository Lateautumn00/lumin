/**
 * FIFO 互斥锁（convert / install 各一把，spec §4 串行约束）：
 * - 先进先出排队；等锁期间可被外部 abort（抛错不占用队列位）
 * - 持有者释放后自动交接下一个等待者
 */
export interface Mutex {
  /** 获取锁；signal abort 则以 aborted=true 拒绝 */
  acquire(signal?: AbortSignal): Promise<void>
  release(): void
  /** 当前是否有持有者 */
  readonly locked: boolean
}

interface Waiter {
  resolve: () => void
  reject: (err: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

export function createMutex(): Mutex {
  let locked = false
  const queue: Waiter[] = []

  const handoff = (): void => {
    const next = queue.shift()
    if (!next) return
    if (next.signal) next.signal.removeEventListener('abort', next.onAbort ?? (() => undefined))
    locked = true
    next.resolve()
  }

  return {
    get locked() {
      return locked
    },
    acquire(signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) return Promise.reject(new Error('aborted'))
      if (!locked && queue.length === 0) {
        locked = true
        return Promise.resolve()
      }
      return new Promise<void>((resolve, reject) => {
        const waiter: Waiter = { resolve, reject, signal }
        if (signal) {
          waiter.onAbort = () => {
            const index = queue.indexOf(waiter)
            if (index >= 0) queue.splice(index, 1)
            reject(new Error('aborted'))
          }
          signal.addEventListener('abort', waiter.onAbort, { once: true })
        }
        queue.push(waiter)
      })
    },
    release(): void {
      if (!locked) return
      if (queue.length === 0) {
        locked = false
        return
      }
      handoff()
    }
  }
}
