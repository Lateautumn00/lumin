/**
 * @file 任务三段式封装（invoke → progress/log → done/error + cancel）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 四页签共享：先订阅再提交、缓冲早到事件、CANCELLED 归一为提示
 */
import { computed, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'

/** 进度快照（total 缺省 = 不确定进度） */
export interface TaskProgressState {
  current: number
  total?: number
  message?: string
}

export interface TaskController {
  running: ComputedRef<boolean>
  progress: Ref<TaskProgressState | null>
  error: Ref<StructuredError | null>
  errorDetail: Ref<string>
  notice: Ref<string>
  submit(submit: () => Promise<{ taskId: string }>): Promise<void>
  cancel(): Promise<void>
  /** 非任务异常（如目录选择失败）直接进错误态 */
  fail(err: unknown): void
  /** 清空错误与提示（保留结果） */
  clearMessages(): void
}

/**
 * 创建一个任务控制器
 * @param onDone 任务成功回调（结果来自 done 事件）
 */
export function useTask<R>(onDone: (result: R) => void): TaskController {
  const busy = ref(false)
  const progress = ref<TaskProgressState | null>(null)
  const error = ref<StructuredError | null>(null)
  const errorDetail = ref('')
  const notice = ref('')

  let unsubscribe: (() => void) | null = null
  let currentTaskId = ''
  /** invoke 返回 taskId 前已到达的事件（小目录可能瞬间完成，先订阅后提交） */
  let pendingEvents: TaskEvent[] = []

  const running = computed(() => busy.value)

  function detach(): void {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    currentTaskId = ''
    pendingEvents = []
  }

  function fail(err: unknown): void {
    const structured = toStructuredError(err)
    error.value = structured
    errorDetail.value = structured.detail ?? ''
    busy.value = false
    progress.value = null
    detach()
  }

  function onEvent(event: TaskEvent): void {
    if (currentTaskId === '') {
      pendingEvents.push(event)
      return
    }
    if (event.taskId !== currentTaskId) return
    if (event.kind === 'progress') {
      progress.value = {
        current: event.current,
        ...(event.total !== undefined ? { total: event.total } : {}),
        ...(event.message !== undefined ? { message: event.message } : {})
      }
      return
    }
    if (event.kind === 'log') return
    detach()
    busy.value = false
    progress.value = null
    if (event.kind === 'done') {
      onDone(event.result as R)
      return
    }
    if (event.error.code === 'CANCELLED') {
      notice.value = '已取消'
      return
    }
    error.value = event.error
    errorDetail.value = event.error.detail ?? ''
  }

  async function submit(submitTask: () => Promise<{ taskId: string }>): Promise<void> {
    if (busy.value) return
    error.value = null
    errorDetail.value = ''
    notice.value = ''
    busy.value = true
    progress.value = { current: 0 }
    pendingEvents = []
    unsubscribe = window.lumin.onTaskEvent(onEvent)
    try {
      const { taskId } = await submitTask()
      currentTaskId = taskId
      const replay = pendingEvents.splice(0)
      for (const event of replay) {
        if (event.taskId === taskId) onEvent(event)
      }
    } catch (err) {
      fail(err)
    }
  }

  async function cancel(): Promise<void> {
    if (currentTaskId === '') return
    try {
      await window.lumin.invoke('lumin:task:cancel', { taskId: currentTaskId })
    } catch (err) {
      fail(err)
    }
  }

  function clearMessages(): void {
    error.value = null
    errorDetail.value = ''
    notice.value = ''
  }

  onUnmounted(detach)

  return {
    running,
    progress,
    error,
    errorDetail,
    notice,
    submit,
    cancel,
    fail,
    clearMessages
  }
}
