<!-- 四页签共享的任务反馈区：进度（可取消）/ 结构化错误（可重试）/ 提示 -->
<script setup lang="ts">
// 作者：cuilanchao · 修改时间：2026-11-21
import { computed } from 'vue'
import { NAlert, NButton } from 'naive-ui'
import { fileNameOf, type StructuredError } from '@lumin/shared'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { isRetryable } from '../errors'
import type { TaskProgressState } from './use-task'

const props = defineProps<{
  running: boolean
  progress: TaskProgressState | null
  error: StructuredError | null
  errorDetail: string
  notice: string
}>()

const emit = defineEmits<{ cancel: []; retry: [] }>()

const message = computed(() => {
  const current = props.progress
  if (current === null) return '处理中…'
  const name =
    current.message !== undefined && current.message !== '' ? fileNameOf(current.message) : ''
  const count = `已处理 ${current.current} 项`
  return name === '' ? count : `${count} · ${name}`
})

const canRetry = computed(() => {
  const current = props.error
  return current !== null && isRetryable(current.code)
})
</script>

<template>
  <div v-if="running" class="rounded-[var(--lumin-radius-md)] bg-[var(--lumin-color-surface)] p-3">
    <TaskProgress
      :message="message"
      :current="progress?.current ?? 0"
      :total="progress?.total"
      @cancel="emit('cancel')"
    />
  </div>
  <NAlert v-if="error" type="error" :title="`${error.message}（${error.code}）`">
    <div class="flex flex-col gap-2">
      <pre v-if="errorDetail" class="max-h-32 overflow-auto text-xs whitespace-pre-wrap">{{
        errorDetail
      }}</pre>
      <div v-if="canRetry">
        <NButton size="small" @click="emit('retry')">重试</NButton>
      </div>
    </div>
  </NAlert>
  <NAlert v-if="error === null && notice" type="info" :title="notice" />
</template>
