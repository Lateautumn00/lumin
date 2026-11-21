/**
 * @file use-task.test.ts 任务三段式控制器单测（stub window.lumin）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 先订阅后提交、早到事件缓冲、CANCELLED 归一提示、取消与清理
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskEvent } from '@lumin/shared'

// 控制器在组件外使用，屏蔽生命周期钩子告警
vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>()
  return { ...actual, onUnmounted: () => undefined }
})

const { useTask } = await import('./use-task')

let listener: ((event: TaskEvent) => void) | null = null
const invoke = vi.fn(async () => ({ taskId: 'task-1' }))

beforeEach(() => {
  listener = null
  invoke.mockClear()
  vi.stubGlobal('window', {
    lumin: {
      onTaskEvent: (fn: (event: TaskEvent) => void) => {
        listener = fn
        return () => {
          listener = null
        }
      },
      invoke
    }
  })
})

function emit(event: TaskEvent): void {
  if (listener !== null) listener(event)
}

function progressEvent(taskId: string, current: number): TaskEvent {
  return { kind: 'progress', taskId, current, total: 10, message: 'C:\\a\\b.txt' }
}

describe('useTask', () => {
  it('progress → done 流转并回调结果', async () => {
    const results: string[] = []
    const task = useTask<string>((result) => results.push(result))
    await task.submit(async () => ({ taskId: 'task-1' }))
    expect(task.running.value).toBe(true)
    emit(progressEvent('task-1', 3))
    expect(task.progress.value?.current).toBe(3)
    expect(task.progress.value?.total).toBe(10)
    emit({ kind: 'done', taskId: 'task-1', result: 'ok' })
    expect(results).toEqual(['ok'])
    expect(task.running.value).toBe(false)
    expect(task.progress.value).toBeNull()
  })

  it('invoke 返回前到达的事件被缓冲回放', async () => {
    const results: string[] = []
    const task = useTask<string>((result) => results.push(result))
    await task.submit(async () => {
      emit({ kind: 'done', taskId: 'task-1', result: 'early' })
      return { taskId: 'task-1' }
    })
    expect(results).toEqual(['early'])
    expect(task.running.value).toBe(false)
  })

  it('其他任务事件被忽略', async () => {
    const results: string[] = []
    const task = useTask<string>((result) => results.push(result))
    await task.submit(async () => ({ taskId: 'task-1' }))
    emit({ kind: 'done', taskId: 'task-2', result: 'other' })
    expect(results).toEqual([])
    expect(task.running.value).toBe(true)
  })

  it('log 事件被忽略', async () => {
    const task = useTask<string>(() => undefined)
    await task.submit(async () => ({ taskId: 'task-1' }))
    emit({ kind: 'log', taskId: 'task-1', message: 'hi' })
    expect(task.running.value).toBe(true)
  })

  it('CANCELLED 归一为提示而非错误', async () => {
    const task = useTask<string>(() => undefined)
    await task.submit(async () => ({ taskId: 'task-1' }))
    emit({ kind: 'error', taskId: 'task-1', error: { code: 'CANCELLED', message: '已取消' } })
    expect(task.notice.value).toBe('已取消')
    expect(task.error.value).toBeNull()
    expect(task.running.value).toBe(false)
  })

  it('结构化错误进入错误态并保留 detail', async () => {
    const task = useTask<string>(() => undefined)
    await task.submit(async () => ({ taskId: 'task-1' }))
    emit({
      kind: 'error',
      taskId: 'task-1',
      error: { code: 'FC_ROOT_INVALID', message: '无法读取目录', detail: 'ENOENT' }
    })
    expect(task.error.value?.code).toBe('FC_ROOT_INVALID')
    expect(task.errorDetail.value).toBe('ENOENT')
  })

  it('运行中重复提交被忽略', async () => {
    const task = useTask<string>(() => undefined)
    const submit = vi.fn(async () => ({ taskId: 'task-1' }))
    await task.submit(submit)
    await task.submit(submit)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('cancel 调用壳取消通道', async () => {
    const task = useTask<string>(() => undefined)
    await task.submit(async () => ({ taskId: 'task-1' }))
    await task.cancel()
    expect(invoke).toHaveBeenCalledWith('lumin:task:cancel', { taskId: 'task-1' })
  })

  it('fail 把任意异常转为错误态', async () => {
    const task = useTask<string>(() => undefined)
    task.fail(new Error('boom'))
    expect(task.error.value).not.toBeNull()
    expect(task.running.value).toBe(false)
  })

  it('clearMessages 清空错误与提示', async () => {
    const task = useTask<string>(() => undefined)
    task.fail(new Error('boom'))
    task.clearMessages()
    expect(task.error.value).toBeNull()
    expect(task.errorDetail.value).toBe('')
    expect(task.notice.value).toBe('')
  })

  it('提交失败进入错误态', async () => {
    const task = useTask<string>(() => undefined)
    await task.submit(async () => {
      throw new Error('invoke failed')
    })
    expect(task.error.value).not.toBeNull()
    expect(task.running.value).toBe(false)
  })
})
