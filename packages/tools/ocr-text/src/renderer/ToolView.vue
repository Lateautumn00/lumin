<script setup lang="ts">
/**
 * 图片文字识别（ocr-text）：单图 OCR → 可编辑文本 → 复制 / 导出 TXT。
 * 三态：空态（DropZone）/ 加载态（可取消）/ 报错态（重试或重选）；结果态内联展示。
 */
import { computed, onUnmounted, ref } from 'vue'
import { Copy, RefreshCw, Save } from '@lucide/vue'
import { NAlert, NButton, NInput } from 'naive-ui'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import { isRetryable } from '../errors'
import type { RecognizeResult } from '../schema'
import { cancelTask, pickDirectory, revealPath, saveTxt, submitRecognize } from './client'

const file = ref<File | null>(null)
const notice = ref('')
const imageUrl = ref('')
const inputPath = ref('')
const phase = ref<'idle' | 'running' | 'error'>('idle')
const progress = ref<{ current: number; total: number; message: string } | null>(null)
const result = ref<RecognizeResult | null>(null)
const text = ref('')
const error = ref<StructuredError | null>(null)
const invalidHint = ref('')
const savedPath = ref('')
const exporting = ref(false)
const saveError = ref<StructuredError | null>(null)

let currentTaskId = ''
let unsubscribe: (() => void) | undefined

const charCount = computed(() => text.value.replace(/\s+/g, '').length)
const hasResult = computed(() => result.value !== null)

function detach(): void {
  unsubscribe?.()
  unsubscribe = undefined
}

function revokeImage(): void {
  if (imageUrl.value !== '') URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = ''
}

function setError(err: unknown): void {
  error.value = toStructuredError(err)
  phase.value = 'error'
  progress.value = null
}

function onEvent(event: TaskEvent): void {
  if (event.taskId !== currentTaskId) return
  if (event.kind === 'progress') {
    progress.value = {
      current: event.current,
      total: event.total ?? 1,
      message: event.message ?? event.stage ?? ''
    }
    return
  }
  if (event.kind === 'log') return
  detach()
  if (event.kind === 'done') {
    const payload = event.result as RecognizeResult | undefined
    progress.value = null
    phase.value = 'idle'
    if (payload !== undefined) {
      result.value = payload
      text.value = payload.lines.map((line) => line.text).join('\n')
    }
    return
  }
  if (event.error.code === 'CANCELLED') {
    progress.value = null
    phase.value = 'idle'
    return
  }
  error.value = event.error
  phase.value = 'error'
  progress.value = null
}

async function startRecognize(): Promise<void> {
  if (inputPath.value === '') return
  detach()
  phase.value = 'running'
  error.value = null
  saveError.value = null
  savedPath.value = ''
  result.value = null
  text.value = ''
  notice.value = ''
  progress.value = { current: 0, total: 1, message: '准备识别…' }
  try {
    const { taskId } = await submitRecognize({ inputPath: inputPath.value })
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    setError(err)
  }
}

function onSelect(payload: { file: File; path: string }): void {
  detach()
  revokeImage()
  file.value = payload.file
  inputPath.value = payload.path
  imageUrl.value = URL.createObjectURL(payload.file)
  invalidHint.value = ''
  void startRecognize()
}

function onInvalid(reason: string): void {
  invalidHint.value = reason
}

async function onCancel(): Promise<void> {
  if (currentTaskId === '') return
  try {
    await cancelTask(currentTaskId)
  } catch (err) {
    setError(err)
  }
}

function retry(): void {
  if (inputPath.value === '') return
  void startRecognize()
}

function reset(): void {
  detach()
  revokeImage()
  file.value = null
  inputPath.value = ''
  result.value = null
  text.value = ''
  error.value = null
  saveError.value = null
  savedPath.value = ''
  progress.value = null
  invalidHint.value = ''
  notice.value = ''
  phase.value = 'idle'
}

async function copyText(): Promise<void> {
  try {
    await navigator.clipboard.writeText(text.value)
    notice.value = '已复制到剪贴板'
  } catch (err) {
    notice.value = toStructuredError(err).message
  }
}

async function exportTxt(): Promise<void> {
  if (inputPath.value === '' || text.value === '') return
  saveError.value = null
  notice.value = ''
  const outputDir = await pickDirectory('选择 TXT 导出目录')
  if (outputDir === null) return
  exporting.value = true
  try {
    const { output } = await saveTxt({
      outputDir,
      inputPath: inputPath.value,
      text: text.value
    })
    savedPath.value = output
    notice.value = '已导出 TXT'
  } catch (err) {
    saveError.value = toStructuredError(err)
  } finally {
    exporting.value = false
  }
}

function reveal(): void {
  if (savedPath.value === '') return
  void revealPath(savedPath.value)
}

onUnmounted(() => {
  detach()
  revokeImage()
})
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-4">
    <header class="flex flex-col gap-1">
      <h2 class="text-lg font-semibold text-[var(--lumin-color-text)]">图片文字识别</h2>
      <p class="text-sm text-[var(--lumin-color-text-secondary)]">
        离线识别图片中的文字，可编辑后复制或导出 TXT
      </p>
    </header>

    <DropZone
      v-if="file === null"
      accept=".png,.jpg,.jpeg,.webp"
      hint="拖拽图片到此处，或点击选择"
      @select="onSelect"
      @invalid="onInvalid"
    />
    <p v-if="invalidHint !== ''" class="text-sm text-[var(--lumin-color-error)]">
      {{ invalidHint }}
    </p>
    <p v-if="file === null" class="text-xs text-[var(--lumin-color-text-secondary)]">
      支持 PNG / JPG / WebP，单张不超过 20MB；识别全程离线，不上传任何文件。
    </p>

    <template v-if="file !== null">
      <div class="flex items-start gap-4">
        <img
          v-if="imageUrl !== ''"
          :src="imageUrl"
          :alt="file.name"
          class="max-h-48 max-w-64 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] object-contain"
        />
        <div class="flex flex-col gap-1 text-sm text-[var(--lumin-color-text-secondary)]">
          <span class="break-all text-[var(--lumin-color-text)]">{{ file.name }}</span>
          <span v-if="hasResult && result !== null">
            {{ result.width }}×{{ result.height }} 像素 · 识别 {{ result.lines.length }} 行 ·
            {{ charCount }} 字
          </span>
        </div>
      </div>

      <TaskProgress
        v-if="phase === 'running' && progress !== null"
        :message="progress.message"
        :current="progress.current"
        :total="progress.total"
        @cancel="onCancel"
      />

      <template v-if="phase === 'error' && error !== null">
        <NAlert type="error" :title="error.message">
          <p class="text-xs opacity-80">
            {{ error.code }}<template v-if="error.detail"> · {{ error.detail }}</template>
          </p>
        </NAlert>
        <div class="flex gap-2">
          <NButton v-if="isRetryable(error.code)" type="primary" @click="retry">重试</NButton>
          <NButton quaternary @click="reset">重新选择图片</NButton>
        </div>
      </template>

      <template v-if="phase === 'idle' && hasResult">
        <NInput
          v-model:value="text"
          type="textarea"
          :autosize="{ minRows: 10, maxRows: 20 }"
          placeholder="识别结果"
        />
        <div class="flex flex-wrap gap-2">
          <NButton type="primary" @click="copyText">
            <template #icon><Copy :size="16" /></template>
            复制文本
          </NButton>
          <NButton :loading="exporting" @click="exportTxt">
            <template #icon><Save :size="16" /></template>
            导出 TXT
          </NButton>
          <NButton quaternary @click="retry">
            <template #icon><RefreshCw :size="16" /></template>
            重新识别
          </NButton>
          <NButton quaternary @click="reset">重新选择图片</NButton>
        </div>
        <NAlert v-if="saveError !== null" type="error" :title="saveError.message">
          <p class="text-xs opacity-80">{{ saveError.code }}</p>
        </NAlert>
        <p v-if="notice !== ''" class="text-sm text-[var(--lumin-color-text-secondary)]">
          {{ notice }}
        </p>
        <p
          v-if="savedPath !== ''"
          class="break-all text-sm text-[var(--lumin-color-text-secondary)]"
        >
          已导出：{{ savedPath }}
          <NButton text type="primary" @click="reveal">打开所在文件夹</NButton>
        </p>
      </template>

      <div v-if="phase === 'idle' && !hasResult" class="flex gap-2">
        <NButton type="primary" @click="retry">重新识别</NButton>
        <NButton quaternary @click="reset">重新选择图片</NButton>
      </div>
    </template>
  </div>
</template>
