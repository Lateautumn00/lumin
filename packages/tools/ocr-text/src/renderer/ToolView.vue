<script setup lang="ts">
/**
 * 图片/PDF 文字识别（ocr-text）：单张自动识别 / 批量识别双模式；逐项编辑预览 → 复制 / 导出 TXT。
 * 三态：空态（DropZone）/ 加载态（可取消、批内进度）/ 报错态（重试或清空）；单项失败不中断整批。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Copy, FileText, RefreshCw, Save, Trash2 } from '@lucide/vue'
import { NAlert, NButton, NInput, NRadioButton, NRadioGroup, NTag } from 'naive-ui'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import { isRetryable } from '../errors'
import { MAX_BATCH_FILES, MAX_IMAGE_BYTES, type ExportMode, type RecognizeResult } from '../schema'
import { cancelTask, config, exportTxt, pickDirectory, revealPath, submitRecognize } from './client'

type Mode = 'single' | 'batch'

interface UiItem {
  path: string
  name: string
  url: string
  status: 'pending' | 'running' | 'done' | 'failed'
  width?: number
  height?: number
  /** 识别页数（PDF 多页；图片为 1） */
  pageCount?: number
  text: string
  error?: StructuredError
}

const MAX_MB = MAX_IMAGE_BYTES / 1024 / 1024

const mode = ref<Mode>('single')
const items = ref<UiItem[]>([])
const selectedPath = ref('')
const phase = ref<'idle' | 'running' | 'error'>('idle')
const progress = ref<{ current: number; total: number; message: string } | null>(null)
const error = ref<StructuredError | null>(null)
const invalidHint = ref('')
const notice = ref('')
const exportError = ref<StructuredError | null>(null)
const exporting = ref<ExportMode | null>(null)
const outputDir = ref('')
const outputs = ref<string[]>([])

let currentTaskId = ''
let unsubscribe: (() => void) | undefined
let runPaths: string[] = []

const selected = computed(
  () => items.value.find((item) => item.path === selectedPath.value) ?? null
)
const doneItems = computed(() =>
  items.value.filter((item) => item.status === 'done' && item.text !== '')
)
const failedItems = computed(() => items.value.filter((item) => item.status === 'failed'))
const pendingItems = computed(() => items.value.filter((item) => item.status === 'pending'))
const charCount = computed(() => (selected.value?.text ?? '').replace(/\s+/g, '').length)

const STATUS_LABEL: Record<UiItem['status'], string> = {
  pending: '待识别',
  running: '识别中',
  done: '完成',
  failed: '失败'
}

const STATUS_TAG: Record<UiItem['status'], 'default' | 'info' | 'success' | 'error'> = {
  pending: 'default',
  running: 'info',
  done: 'success',
  failed: 'error'
}

function detach(): void {
  unsubscribe?.()
  unsubscribe = undefined
}

function findItem(path: string): UiItem | undefined {
  return items.value.find((item) => item.path === path)
}

/** 是否为 PDF 输入（PDF 无图片预览，列表与详情用文件图标占位） */
function isPdf(path: string): boolean {
  return /\.pdf$/i.test(path)
}

/** 列表项副标题：已识别显示页数（多页）与像素尺寸，否则显示状态文案 */
function itemSizeLabel(item: UiItem): string {
  if (item.width === undefined) return STATUS_LABEL[item.status]
  const pages = item.pageCount !== undefined && item.pageCount > 1 ? `${item.pageCount} 页 · ` : ''
  return `${pages}${item.width}×${item.height}`
}

function setError(err: unknown): void {
  error.value = toStructuredError(err)
  phase.value = 'error'
  progress.value = null
  for (const item of items.value) {
    if (item.status === 'running') item.status = 'pending'
  }
}

function onEvent(event: TaskEvent): void {
  if (event.taskId !== currentTaskId) return
  if (event.kind === 'progress') {
    progress.value = {
      current: event.current,
      total: event.total ?? runPaths.length,
      message: event.message ?? event.stage ?? ''
    }
    const path = runPaths[event.current]
    if (path !== undefined) {
      const item = findItem(path)
      if (item !== undefined && item.status === 'pending') item.status = 'running'
    }
    return
  }
  if (event.kind === 'log') return
  detach()
  if (event.kind === 'done') {
    progress.value = null
    phase.value = 'idle'
    const payload = event.result as RecognizeResult | undefined
    if (payload !== undefined) applyResults(payload)
    return
  }
  if (event.error.code === 'CANCELLED') {
    progress.value = null
    phase.value = 'idle'
    for (const item of items.value) {
      if (item.status === 'running') item.status = 'pending'
    }
    notice.value = '已取消识别'
    return
  }
  setError(event.error)
}

function applyResults(payload: RecognizeResult): void {
  const byPath = new Map(payload.items.map((item) => [item.inputPath, item]))
  for (const path of runPaths) {
    const item = findItem(path)
    const result = byPath.get(path)
    if (item === undefined || result === undefined) continue
    if (result.status === 'done') {
      item.status = 'done'
      item.text = result.text
      item.width = result.width
      item.height = result.height
      item.pageCount = result.pageCount
      item.error = undefined
    } else {
      item.status = 'failed'
      item.text = ''
      item.error = result.error
    }
  }
  for (const item of items.value) {
    if (item.status === 'running') item.status = 'pending'
  }
  const failed = failedItems.value.length
  notice.value =
    failed === 0
      ? `识别完成：${doneItems.value.length} 个文件全部成功`
      : `识别完成：${doneItems.value.length} 个文件成功，${failed} 个失败`
  if (selected.value === null || selected.value.status !== 'done') {
    selectedPath.value = doneItems.value[0]?.path ?? failedItems.value[0]?.path ?? ''
  }
}

async function startRecognize(paths: string[]): Promise<void> {
  if (paths.length === 0 || phase.value === 'running') return
  detach()
  phase.value = 'running'
  error.value = null
  exportError.value = null
  outputs.value = []
  notice.value = ''
  runPaths = paths
  for (const path of paths) {
    const item = findItem(path)
    if (item === undefined) continue
    item.status = 'pending'
    item.text = ''
    item.error = undefined
  }
  progress.value = { current: 0, total: paths.length, message: '准备识别…' }
  try {
    const { taskId } = await submitRecognize({ inputPaths: paths })
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    setError(err)
  }
}

function onSelect(payload: { file: File; path: string }): void {
  invalidHint.value = ''
  if (mode.value === 'single') {
    resetAll()
    const item: UiItem = {
      path: payload.path,
      name: payload.file.name,
      url: URL.createObjectURL(payload.file),
      status: 'pending',
      text: ''
    }
    items.value.push(item)
    selectedPath.value = item.path
    void startRecognize([item.path])
    return
  }
  if (findItem(payload.path) !== undefined) {
    invalidHint.value = `已在列表中：${payload.file.name}`
    return
  }
  if (items.value.length >= MAX_BATCH_FILES) {
    invalidHint.value = `单次最多 ${MAX_BATCH_FILES} 个文件，请分批处理`
    return
  }
  const item: UiItem = {
    path: payload.path,
    name: payload.file.name,
    url: URL.createObjectURL(payload.file),
    status: 'pending',
    text: ''
  }
  items.value.push(item)
  if (selectedPath.value === '') selectedPath.value = item.path
}

/** 模式切换：运行中禁用；切换时清空列表、结果与错误（spec §2.2） */
function switchMode(next: string | number | boolean): void {
  if (phase.value === 'running') return
  const value = next === 'batch' ? 'batch' : 'single'
  if (value === mode.value) return
  resetAll()
  mode.value = value
}

function onInvalid(reason: string): void {
  invalidHint.value = reason
}

function removeItem(path: string): void {
  if (phase.value === 'running') return
  const index = items.value.findIndex((item) => item.path === path)
  if (index < 0) return
  const [removed] = items.value.splice(index, 1)
  if (removed !== undefined) URL.revokeObjectURL(removed.url)
  if (selectedPath.value === path) {
    selectedPath.value = items.value[0]?.path ?? ''
  }
}

function onEditText(value: string): void {
  const item = selected.value
  if (item !== null) item.text = value
}

function selectItem(path: string): void {
  selectedPath.value = path
}

async function onCancel(): Promise<void> {
  if (currentTaskId === '') return
  try {
    await cancelTask(currentTaskId)
  } catch (err) {
    setError(err)
  }
}

function retryAll(): void {
  void startRecognize(items.value.map((item) => item.path))
}

function retryFailed(): void {
  void startRecognize(failedItems.value.map((item) => item.path))
}

function startPending(): void {
  void startRecognize(pendingItems.value.map((item) => item.path))
}

function resetAll(): void {
  if (phase.value === 'running') return
  for (const item of items.value) URL.revokeObjectURL(item.url)
  items.value = []
  selectedPath.value = ''
  phase.value = 'idle'
  progress.value = null
  error.value = null
  invalidHint.value = ''
  notice.value = ''
  exportError.value = null
  outputs.value = []
}

async function copyText(text: string, tip: string): Promise<void> {
  if (text === '') return
  try {
    await navigator.clipboard.writeText(text)
    notice.value = tip
  } catch (err) {
    notice.value = toStructuredError(err).message
  }
}

function copyCurrent(): void {
  const item = selected.value
  if (item === null) return
  void copyText(item.text, `已复制「${item.name}」的文本`)
}

function formatAll(): string {
  return doneItems.value.map((item) => `===== ${item.name} =====\n${item.text}`).join('\n\n')
}

function copyAll(): void {
  void copyText(formatAll(), `已复制 ${doneItems.value.length} 个文件的文本`)
}

async function changeOutputDir(): Promise<void> {
  const dir = await pickDirectory('选择 TXT 导出目录')
  if (dir !== null) {
    outputDir.value = dir
    notice.value = '已更新导出目录'
  }
}

async function doExport(mode: ExportMode): Promise<void> {
  if (doneItems.value.length === 0 || exporting.value !== null) return
  exportError.value = null
  outputs.value = []
  let dir = outputDir.value
  if (dir === '') {
    const picked = await pickDirectory('选择 TXT 导出目录')
    if (picked === null) return
    dir = picked
  }
  exporting.value = mode
  try {
    const result = await exportTxt({
      outputDir: dir,
      mode,
      items: doneItems.value.map((item) => ({ fileName: item.name, text: item.text }))
    })
    outputDir.value = dir
    outputs.value = result.outputs
    notice.value = mode === 'merged' ? '已合并导出 TXT' : `已导出 ${result.outputs.length} 个 TXT`
  } catch (err) {
    exportError.value = toStructuredError(err)
  } finally {
    exporting.value = null
  }
}

function revealFirst(): void {
  const first = outputs.value[0]
  if (first !== undefined) void revealPath(first)
}

onMounted(() => {
  void config()
    .then((result) => {
      outputDir.value = result.outputDir
    })
    .catch(() => undefined)
})

onUnmounted(() => {
  detach()
  for (const item of items.value) URL.revokeObjectURL(item.url)
})
</script>

<template>
  <div class="flex max-w-5xl flex-col gap-4">
    <header class="flex flex-col gap-2">
      <h2 class="text-lg font-semibold text-[var(--lumin-color-text)]">图片文字识别</h2>
      <p class="text-sm text-[var(--lumin-color-text-secondary)]">
        支持图片与 PDF：单张自动识别，或一次选择多个文件批量识别；结果可编辑、复制或导出 TXT，全程离线。
      </p>
      <NRadioGroup
        :value="mode"
        size="small"
        :disabled="phase === 'running'"
        aria-label="识别模式"
        @update:value="switchMode"
      >
        <NRadioButton value="single" label="单张识别" />
        <NRadioButton value="batch" label="批量识别" />
      </NRadioGroup>
    </header>

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
        <NButton v-if="isRetryable(error.code)" type="primary" @click="retryAll">重试</NButton>
        <NButton quaternary @click="resetAll">
          {{ mode === 'single' ? '重新选择' : '清空列表' }}
        </NButton>
      </div>
    </template>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <section class="flex flex-col gap-2">
        <template v-if="mode === 'single'">
          <DropZone
            v-if="items.length === 0"
            accept=".png,.jpg,.jpeg,.webp,.pdf"
            hint="拖拽或点击选择一个文件（图片 / PDF）"
            :disabled="phase === 'running'"
            @select="onSelect"
            @invalid="onInvalid"
          />
          <template v-else>
            <p class="text-sm text-[var(--lumin-color-text-secondary)]">
              已选择文件；如需更换，请点击下方按钮。
            </p>
            <NButton quaternary :disabled="phase === 'running'" @click="resetAll">
              重新选择文件
            </NButton>
          </template>
          <p class="text-xs text-[var(--lumin-color-text-secondary)]">
            支持 PNG / JPG / WebP / PDF，单个不超过 {{ MAX_MB }}MB（PDF 最多 30 页）；选择后自动识别，全程离线。
          </p>
        </template>

        <template v-else>
          <DropZone
            accept=".png,.jpg,.jpeg,.webp,.pdf"
            hint="拖拽或点击添加文件（可多选）"
            multiple
            :disabled="phase === 'running'"
            @select="onSelect"
            @invalid="onInvalid"
          />
          <p class="text-xs text-[var(--lumin-color-text-secondary)]">
            支持 PNG / JPG / WebP / PDF，单个不超过 {{ MAX_MB }}MB（PDF 最多 30 页），单次最多
            {{ MAX_BATCH_FILES }} 个文件；识别全程离线。
          </p>

          <ul v-if="items.length > 0" class="flex max-h-80 flex-col gap-1 overflow-auto pr-1">
            <li v-for="item in items" :key="item.path" class="flex items-center gap-1">
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--lumin-radius-md)] px-2 py-1.5 text-left transition-colors"
                :class="
                  selectedPath === item.path
                    ? 'bg-[var(--lumin-color-primary-soft)]'
                    : 'hover:bg-[var(--lumin-color-surface)]'
                "
                :aria-label="`查看 ${item.name}`"
                @click="selectItem(item.path)"
              >
                <img
                  v-if="!isPdf(item.path)"
                  :src="item.url"
                  :alt="item.name"
                  class="h-9 w-9 shrink-0 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] object-cover"
                />
                <span
                  v-else
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] text-[var(--lumin-color-text-secondary)]"
                  aria-hidden="true"
                >
                  <FileText :size="16" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm text-[var(--lumin-color-text)]">{{
                    item.name
                  }}</span>
                  <span class="text-xs text-[var(--lumin-color-text-secondary)]">
                    {{ itemSizeLabel(item) }}
                  </span>
                </span>
                <NTag size="small" :type="STATUS_TAG[item.status]">{{
                  STATUS_LABEL[item.status]
                }}</NTag>
              </button>
              <NButton
                text
                :disabled="phase === 'running'"
                :aria-label="`移除 ${item.name}`"
                @click="removeItem(item.path)"
              >
                <template #icon><Trash2 :size="14" /></template>
              </NButton>
            </li>
          </ul>
          <p v-if="items.length === 0" class="text-sm text-[var(--lumin-color-text-secondary)]">
            列表为空：添加文件后点击「开始识别」。
          </p>
        </template>

        <p v-if="invalidHint !== ''" class="text-sm text-[var(--lumin-color-error)]">
          {{ invalidHint }}
        </p>
      </section>

      <section
        class="flex min-h-64 flex-col gap-3 rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] p-3"
      >
        <template v-if="selected !== null">
          <div class="flex items-start gap-3">
            <img
              v-if="!isPdf(selected.path)"
              :src="selected.url"
              :alt="selected.name"
              class="max-h-40 max-w-56 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] object-contain"
            />
            <span
              v-else
              class="flex h-24 w-20 shrink-0 items-center justify-center rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] text-[var(--lumin-color-text-secondary)]"
              aria-hidden="true"
            >
              <FileText :size="28" />
            </span>
            <div
              class="flex min-w-0 flex-col gap-1 text-sm text-[var(--lumin-color-text-secondary)]"
            >
              <span class="break-all text-[var(--lumin-color-text)]">{{ selected.name }}</span>
              <span v-if="selected.status === 'done'">
                <template v-if="selected.pageCount !== undefined && selected.pageCount > 1">
                  {{ selected.pageCount }} 页 ·
                </template>
                {{ selected.width }}×{{ selected.height }} 像素 · {{ charCount }} 字
              </span>
              <span v-if="selected.status === 'failed' && selected.error !== undefined">
                {{ selected.error.message }}
                <template v-if="selected.error.detail"> · {{ selected.error.detail }}</template>
              </span>
              <span
                v-if="selected.status === 'failed' && selected.error !== undefined"
                class="text-xs opacity-70"
              >
                {{ selected.error.code }}
              </span>
            </div>
          </div>
          <NInput
            :value="selected.text"
            type="textarea"
            :autosize="{ minRows: 8, maxRows: 18 }"
            :disabled="selected.status === 'failed'"
            placeholder="识别结果（可编辑）"
            @update:value="onEditText"
          />
          <div class="flex flex-wrap gap-2">
            <NButton
              type="primary"
              :disabled="selected.status !== 'done' || selected.text === ''"
              @click="copyCurrent"
            >
              <template #icon><Copy :size="16" /></template>
              {{ mode === 'single' ? '复制文本' : '复制当前' }}
            </NButton>
            <NButton
              v-if="mode === 'single' && selected.status === 'done'"
              :loading="exporting === 'per-file'"
              :disabled="phase === 'running'"
              @click="doExport('per-file')"
            >
              <template #icon><Save :size="16" /></template>
              导出 TXT
            </NButton>
            <NButton
              v-if="
                selected.status === 'failed' &&
                selected.error !== undefined &&
                isRetryable(selected.error.code)
              "
              @click="retryFailed"
            >
              <template #icon><RefreshCw :size="16" /></template>
              {{ mode === 'single' ? '重试' : '重试失败项' }}
            </NButton>
            <NButton
              v-if="mode === 'single' && selected.status === 'done' && phase !== 'running'"
              quaternary
              @click="retryAll"
            >
              <template #icon><RefreshCw :size="16" /></template>
              重新识别
            </NButton>
            <NButton
              v-if="mode === 'single' && selected.status === 'done'"
              text
              type="primary"
              @click="changeOutputDir"
            >
              更改导出目录
            </NButton>
          </div>
        </template>
        <p v-else class="text-sm text-[var(--lumin-color-text-secondary)]">
          {{
            mode === 'single'
              ? '拖拽或选择文件（图片 / PDF），将自动开始识别。'
              : '在左侧选择文件查看识别结果；未识别的文件会显示状态标签。'
          }}
        </p>
      </section>
    </div>

    <div v-if="mode === 'batch' && items.length > 0" class="flex flex-wrap items-center gap-2">
      <NButton
        v-if="pendingItems.length > 0 && phase !== 'running'"
        type="primary"
        @click="startPending"
      >
        <template #icon><RefreshCw :size="16" /></template>
        开始识别（{{ pendingItems.length }} 个）
      </NButton>
      <NButton v-if="failedItems.length > 0 && phase !== 'running'" @click="retryFailed">
        <template #icon><RefreshCw :size="16" /></template>
        重试失败项（{{ failedItems.length }}）
      </NButton>
      <NButton v-if="doneItems.length > 0 && phase !== 'running'" quaternary @click="retryAll">
        全部重新识别
      </NButton>
      <NButton
        v-if="doneItems.length > 0"
        quaternary
        :disabled="phase === 'running'"
        @click="copyAll"
      >
        <template #icon><Copy :size="16" /></template>
        复制全部
      </NButton>
      <NButton
        v-if="doneItems.length > 0"
        :loading="exporting === 'per-file'"
        :disabled="phase === 'running'"
        @click="doExport('per-file')"
      >
        <template #icon><Save :size="16" /></template>
        导出全部 TXT
      </NButton>
      <NButton
        v-if="doneItems.length > 0"
        :loading="exporting === 'merged'"
        :disabled="phase === 'running'"
        @click="doExport('merged')"
      >
        <template #icon><Save :size="16" /></template>
        合并导出 TXT
      </NButton>
      <NButton text type="primary" @click="changeOutputDir">更改导出目录</NButton>
      <NButton quaternary :disabled="phase === 'running'" @click="resetAll">清空列表</NButton>
    </div>

    <NAlert v-if="exportError !== null" type="error" :title="exportError.message">
      <p class="text-xs opacity-80">
        {{ exportError.code
        }}<template v-if="exportError.detail"> · {{ exportError.detail }}</template>
      </p>
    </NAlert>
    <p v-if="notice !== ''" class="text-sm text-[var(--lumin-color-text-secondary)]">
      {{ notice }}
    </p>
    <p v-if="outputs.length > 0" class="break-all text-sm text-[var(--lumin-color-text-secondary)]">
      已导出 {{ outputs.length }} 个文件：{{ outputs[0] }}
      <NButton text type="primary" @click="revealFirst">打开所在文件夹</NButton>
    </p>
  </div>
</template>
