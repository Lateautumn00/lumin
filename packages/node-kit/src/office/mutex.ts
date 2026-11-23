/**
 * soffice 单实例串行锁（AGENTS §6：soffice 必须串行）。
 *
 * 工具运行在同一主进程内，若各工具各持一把锁则无法真正串行；因此 createMutex 与
 * soffice 专用单例统一上提至 node-kit，供 docx2pdf / file-preview 共享。
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

/** 全局 soffice 串行锁（模块级单例，跨工具共享） */
export const sofficeMutex: Mutex = createMutex()
