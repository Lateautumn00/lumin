<script setup lang="ts">
/**
 * @file 「切成两页」动作面板（A3 横向双页 → 两页 A4，spec §11）：内嵌于 OCR 页签。
 * @author cuilanchao
 * @date 2026-11-25
 * @description 复用父级已选文件（inputPath 由 props 注入），只负责提交切分任务、
 *              展示阶段进度（可取消）、结构化报错与产物回显；自动检测纸张边界与
 *              中间分割线，无需手动调参。切完即结束，不自动继续 OCR 切题。
 */
import { computed, ref, watch } from 'vue'
import { NButton, NText } from 'naive-ui'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { isRetryable } from '../errors'
import type { HalveDetection, HalvePayload, HalveResult } from '../schema'
import { cancelTask, revealPath, submitHalve } from './client'
import ErrorCard from './ErrorCard.vue'
import ResultCard from './ResultCard.vue'

const props = defineProps<{ inputPath: string; disabled?: boolean }>()
const emit = defineEmits<{ reselect: [] }>()

/** 报错态显示 [重新选择] 的码（spec §5） */
const RESELECT_CODES = new Set([
  'PDF_NOT_FOUND',
  'PDF_LOCKED',
  'PDF_ENCRYPTED',
  'PDF_INVALID',
  'OCR_INPUT_INVALID'
])

const running = ref(false)
const progress = ref<{ current?: number; total?: number; message: string } | null>(null)
const error = ref<StructuredError | null>(null)
const outputPaths = ref<string[]>([])
const detections = ref<HalveDetection[]>([])

let unsubscribe: (() => void) | null = null
let currentTaskId = ''

const busy = computed(() => running.value)
const retryable = computed(() => error.value !== null && isRetryable(error.value.code))
const canSubmit = computed(() => props.inputPath !== '' && !busy.value && props.disabled !== true)
const detectionSummary = computed(() => {
  const items = detections.value
  if (items.length === 0) return ''
  const gutter = items.filter((item) => item.usedGutter).length
  const trimmed = items.filter((item) => item.trimmed).length
  const mid = items.length - gutter
  return `共 ${items.length} 页：${gutter} 页按装订沟切分${mid > 0 ? `、${mid} 页按中线` : ''}${
    trimmed > 0 ? `；${trimmed} 页自动裁去扫描黑边` : ''
  }`
})

/** 撤销任务事件订阅并清空当前任务号 */
function detach(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  currentTaskId = ''
}

/** 统一报错落位（结构化归一 + 停加载态） */
function setError(err: unknown): void {
  error.value = toStructuredError(err)
  running.value = false
  progress.value = null
  detach()
}

/** 任务事件：progress 回显进度，done 回显产物，error 落报错态 */
function onEvent(event: TaskEvent): void {
  if (event.taskId !== currentTaskId) return
  if (event.kind === 'progress') {
    progress.value = {
      ...(event.current !== undefined ? { current: event.current } : {}),
      ...(event.total !== undefined ? { total: event.total } : {}),
      message: event.message ?? event.stage ?? ''
    }
    return
  }
  if (event.kind === 'log') return
  detach()
  running.value = false
  progress.value = null
  if (event.kind === 'done') {
    const result = event.result as HalveResult | undefined
    outputPaths.value = result?.outputPaths ?? []
    detections.value = result?.detections ?? []
    return
  }
  if (event.error.code === 'CANCELLED') return
  error.value = event.error
}

/** 提交切分任务并订阅进度 */
async function start(): Promise<void> {
  if (!canSubmit.value) return
  error.value = null
  outputPaths.value = []
  detections.value = []
  running.value = true
  progress.value = { message: '提交中…' }
  try {
    const payload: HalvePayload = { inputPath: props.inputPath }
    const { taskId } = await submitHalve(payload)
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    setError(err)
  }
}

/** 取消进行中的切分任务 */
async function onCancel(): Promise<void> {
  if (currentTaskId === '') return
  try {
    await cancelTask(currentTaskId)
  } catch (err) {
    setError(err)
  }
}

/** 清结果卡保留输入（再切一个） */
function resetResult(): void {
  outputPaths.value = []
  detections.value = []
  error.value = null
  progress.value = null
}

/** 在资源管理器中定位首个产物 */
async function openFolder(): Promise<void> {
  const first = outputPaths.value[0]
  if (first === undefined) return
  try {
    await revealPath(first)
  } catch (err) {
    setError(err)
  }
}

// 换文件即重置本面板（避免旧结果/旧报错串台）
watch(
  () => props.inputPath,
  () => {
    detach()
    running.value = false
    progress.value = null
    error.value = null
    outputPaths.value = []
    detections.value = []
  }
)
</script>

<template>
  <section class="flex flex-col gap-3" aria-label="切成两页">
    <NText depth="3" class="text-xs">
      自动识别纸张边界与中间分割线，把一张 A3 横向双页均匀切成两张 A4；PDF
      输出单个多页文件，图片输出左右两张原格式图。竖版单页不支持；扫描黑边会自动裁除。
    </NText>

    <NButton type="primary" :disabled="!canSubmit" :loading="busy" @click="start">
      切成两页
    </NButton>

    <!-- 加载态：阶段进度 + 取消 -->
    <TaskProgress
      v-if="running"
      :message="progress?.message ?? ''"
      :current="progress?.current"
      :total="progress?.total"
      @cancel="onCancel"
    />

    <!-- 报错态 -->
    <ErrorCard v-if="error !== null" :error="error" :retryable="retryable" @retry="start">
      <template #actions>
        <NButton v-if="RESELECT_CODES.has(error.code)" size="small" @click="emit('reselect')">
          重新选择
        </NButton>
      </template>
    </ErrorCard>

    <!-- 成功结果卡 + 检测依据 -->
    <ResultCard
      v-if="outputPaths.length > 0"
      :title="`切分完成（${outputPaths.length} 个文件）`"
      :paths="outputPaths"
      reset-label="再切一个"
      @open="openFolder"
      @reset="resetResult"
    />
    <NText v-if="detectionSummary !== ''" depth="3" class="text-xs">
      {{ detectionSummary }}
    </NText>
  </section>
</template>
