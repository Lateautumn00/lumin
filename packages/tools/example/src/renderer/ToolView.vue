<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { NButton, NSpace, NSpin, NText } from 'naive-ui'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import { ping, submitSleep } from './client'

type Phase = 'idle' | 'running' | 'error'
type Action = 'ping' | 'sleep'

const phase = ref<Phase>('idle')
const progress = ref<{ current: number; total?: number } | null>(null)
const pingResult = ref('')
const errorMessage = ref('')
const lastAction = ref<Action | null>(null)

let unsubscribe: (() => void) | null = null
let currentTaskId = ''

function detach(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  currentTaskId = ''
}

function setError(err: unknown): void {
  const error: StructuredError = toStructuredError(err)
  phase.value = 'error'
  errorMessage.value = error.message
  progress.value = null
  detach()
}

function onEvent(event: TaskEvent): void {
  if (event.taskId !== currentTaskId) return
  if (event.kind === 'progress') {
    progress.value = { current: event.current, total: event.total }
    return
  }
  if (event.kind === 'log') return
  detach()
  if (event.kind === 'done') {
    phase.value = 'idle'
    progress.value = null
    return
  }
  if (event.error.code === 'CANCELLED') {
    phase.value = 'idle'
    progress.value = null
  } else {
    phase.value = 'error'
    errorMessage.value = event.error.message
    progress.value = null
  }
}

async function runPing(): Promise<void> {
  lastAction.value = 'ping'
  try {
    const result = await ping()
    pingResult.value = `pong · ${new Date(result.at).toLocaleTimeString()}`
    errorMessage.value = ''
    phase.value = 'idle'
  } catch (err) {
    setError(err)
  }
}

async function runSleep(): Promise<void> {
  lastAction.value = 'sleep'
  phase.value = 'running'
  progress.value = { current: 0 }
  errorMessage.value = ''
  try {
    const { taskId } = await submitSleep({ durationMs: 3000 })
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    setError(err)
  }
}

async function cancelSleep(): Promise<void> {
  if (currentTaskId === '') return
  try {
    await window.lumin.invoke('lumin:task:cancel', { taskId: currentTaskId })
  } catch (err) {
    setError(err)
  }
}

function retry(): void {
  if (lastAction.value === 'sleep') {
    void runSleep()
  } else {
    void runPing()
  }
}

onUnmounted(() => {
  detach()
})
</script>

<template>
  <div class="flex max-w-xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">示例工具</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        验证 ping 与三段式长任务（提交 → 进度推送 → 取消/完成）
      </p>
    </div>

    <NSpace>
      <NButton @click="runPing">Ping</NButton>
      <NButton type="primary" :disabled="phase === 'running'" @click="runSleep">
        运行 3 秒任务
      </NButton>
      <NButton v-if="phase === 'running'" type="error" ghost @click="cancelSleep">取消</NButton>
      <NButton v-if="phase === 'error'" size="small" @click="retry">重试</NButton>
    </NSpace>

    <div v-if="phase === 'running'" class="flex items-center gap-3">
      <NSpin size="small" />
      <NText class="text-sm">
        进度 {{ progress?.current ?? 0
        }}<template v-if="progress?.total">/{{ progress.total }}</template>
      </NText>
    </div>

    <NText v-if="phase === 'error'" type="error" class="text-sm">{{ errorMessage }}</NText>
    <NText v-if="pingResult" depth="3" class="text-sm">{{ pingResult }}</NText>
  </div>
</template>
