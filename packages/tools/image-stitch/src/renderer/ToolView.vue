<script setup lang="ts">
/**
 * 图片拼接（image-stitch）：多选图片 → 纵向/横向长图或网格 → 输出单张图。
 * 三态：空态（DropZone）/ 加载态（量尺寸 + 绘制两阶段，可取消）/ 报错态（重试或重选）；结果态内联展示。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { FolderOpen, Plus, RefreshCw, Scissors, Trash2, X } from '@lucide/vue'
import {
  NAlert,
  NButton,
  NColorPicker,
  NInput,
  NInputNumber,
  NRadio,
  NRadioGroup,
  NSlider,
  NTabPane,
  NTabs
} from 'naive-ui'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import PathLink from '@lumin/ui/PathLink.vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import { planLayout, planOverLimit, type LayoutPlan } from '../contract'
import { isRetryable } from '../errors'
import {
  LIMITS,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  SPLIT_LIMITS,
  type ImageEncoder,
  type LayoutOptions,
  type SizeMode,
  type SplitModeValue,
  type SplitPayload,
  type SplitResult,
  type StitchMode,
  type StitchPayload,
  type StitchResult
} from '../schema'
import {
  cancelTask,
  config,
  pickDirectory,
  revealPath,
  setOutputDir,
  split,
  submitStitch
} from './client'

/** 已选图片（url 为预览 ObjectURL，移除/卸载时 revoke） */
interface PickedImage {
  file: File
  path: string
  url: string
  size: number
}

const ACCEPT = '.png,.jpg,.jpeg,.webp'
const PREVIEW_MAX_W = 480
const PREVIEW_MAX_H = 320

const MODE_LABELS: Record<StitchMode, string> = {
  vertical: '纵向拼接',
  horizontal: '横向拼接',
  grid: '网格'
}

const SIZE_MODE_LABELS: Record<SizeMode, string> = {
  first: '首图',
  max: '最大',
  fixed: '固定'
}

const ENCODER_LABELS: Record<ImageEncoder, string> = {
  png: 'PNG',
  jpeg: 'JPG',
  webp: 'WebP'
}

const STAGE_LABELS: Record<string, string> = {
  measure: '量尺寸',
  draw: '绘制',
  read: '读取',
  split: '切分'
}

/** 页签（M40：新增长图分割） */
type TabKey = 'stitch' | 'split'

const files = ref<PickedImage[]>([])
const mode = ref<StitchMode>('vertical')
const sizeMode = ref<SizeMode>('first')
const fixedSize = ref(2000)
const columns = ref(3)
const gutter = ref(12)
const padding = ref(0)
const bgColor = ref('#ffffff')
const encoder = ref<ImageEncoder>('png')
const quality = ref(90)
const outputDir = ref('')
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const planInfo = ref<{ width: number; height: number } | null>(null)
const invalidHint = ref('')
const phase = ref<'idle' | 'running' | 'error'>('idle')
const progress = ref<{
  current: number
  total: number
  stage: string
  message: string
} | null>(null)
const error = ref<StructuredError | null>(null)
const result = ref<StitchResult | null>(null)
// 长图分割（M40，spec §3.6/§5）
const activeTab = ref<TabKey>('stitch')
const activeTask = ref<TabKey>('stitch')
const splitFile = ref<PickedImage | null>(null)
const splitMode = ref<SplitModeValue>('height')
const splitHeight = ref(1000)
const splitParts = ref(3)
const splitQuality = ref(90)
const splitResult = ref<SplitResult | null>(null)

let currentTaskId = ''
let unsubscribe: (() => void) | undefined
let previewTimer: number | undefined
let previewSeq = 0

const layout = computed<LayoutOptions>(() => ({
  mode: mode.value,
  sizeMode: sizeMode.value,
  fixedSize: fixedSize.value,
  columns: columns.value,
  gutter: gutter.value,
  padding: padding.value
}))

const canStart = computed(
  () => files.value.length > 0 && outputDir.value !== '' && phase.value !== 'running'
)

/** 长图分割可提交（单图 + 输出目录 + 非运行中） */
const canSplit = computed(
  () => splitFile.value !== null && outputDir.value !== '' && phase.value !== 'running'
)

/** 分割输出为 PNG 时质量无效（spec §5.3） */
const splitIsLossless = computed(
  () => (splitFile.value?.path ?? '').toLowerCase().endsWith('.png')
)

const progressMessage = computed(() => {
  if (progress.value === null) return ''
  const stage = STAGE_LABELS[progress.value.stage] ?? progress.value.stage
  return `${stage} ${progress.value.current}/${progress.value.total} · ${progress.value.message}`
})

/** 预计输出尺寸文案 */
const planLabel = computed(() => {
  if (planInfo.value === null) return '预览不可用（图片无法读取或参数无效），仍可直接开始拼接'
  return `预计输出 ${planInfo.value.width} × ${planInfo.value.height} px`
})

/** 预览签名：图片集合 + 布局 + 背景色任一变化即防抖重绘 */
const previewSignature = computed(() =>
  JSON.stringify({ files: files.value.map((item) => item.url), layout: layout.value, bg: bgColor.value })
)

watch(previewSignature, () => schedulePreview(), { immediate: true })

function schedulePreview(): void {
  if (previewTimer !== undefined) window.clearTimeout(previewTimer)
  previewTimer = window.setTimeout(() => {
    previewTimer = undefined
    void drawPreview()
  }, 200)
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
}

/** 缩比绘制完整布局（与 worker 共用 contract.planLayout；不写盘） */
async function drawPreview(): Promise<void> {
  const canvas = previewCanvas.value
  if (canvas === null || files.value.length === 0) {
    planInfo.value = null
    return
  }
  const seq = ++previewSeq
  let images: HTMLImageElement[]
  try {
    images = await Promise.all(files.value.map((item) => loadHtmlImage(item.url)))
  } catch {
    return
  }
  if (seq !== previewSeq) return

  const sizes = images.map((image) => ({ width: image.naturalWidth, height: image.naturalHeight }))
  const plan: LayoutPlan | null = planLayout(sizes, layout.value)
  if (plan === null || planOverLimit(plan)) {
    planInfo.value = null
    canvas.width = 0
    canvas.height = 0
    return
  }
  planInfo.value = { width: plan.width, height: plan.height }

  const scale = Math.min(PREVIEW_MAX_W / plan.width, PREVIEW_MAX_H / plan.height, 1)
  const width = Math.max(1, Math.round(plan.width * scale))
  const height = Math.max(1, Math.round(plan.height * scale))
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) return
  ctx.fillStyle = bgColor.value
  ctx.fillRect(0, 0, width, height)
  plan.placements.forEach((placement, index) => {
    const image = images[index]
    if (image === undefined) return
    ctx.drawImage(
      image,
      Math.round(placement.x * scale),
      Math.round(placement.y * scale),
      Math.max(1, Math.round(placement.width * scale)),
      Math.max(1, Math.round(placement.height * scale))
    )
  })
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** 追加图片（去重 + 上限 + 体积预警；ObjectURL 供缩略图/预览） */
function addFile(payload: { file: File; path: string }): void {
  invalidHint.value = ''
  if (files.value.some((item) => item.path === payload.path)) return
  if (payload.file.size > MAX_IMAGE_BYTES) {
    invalidHint.value = `图片超过 40MB，已跳过：${payload.file.name}`
    return
  }
  if (files.value.length >= MAX_IMAGES) {
    invalidHint.value = `单次最多 ${MAX_IMAGES} 张图片`
    return
  }
  files.value.push({
    file: payload.file,
    path: payload.path,
    url: URL.createObjectURL(payload.file),
    size: payload.file.size
  })
}

function removeFile(index: number): void {
  const item = files.value[index]
  if (item !== undefined) URL.revokeObjectURL(item.url)
  files.value.splice(index, 1)
}

function clearFiles(): void {
  for (const item of files.value) URL.revokeObjectURL(item.url)
  files.value = []
  invalidHint.value = ''
}

function detach(): void {
  unsubscribe?.()
  unsubscribe = undefined
}

function setError(err: unknown): void {
  error.value = toStructuredError(err)
  phase.value = 'error'
  progress.value = null
}

/** 任务事件：progress → 两阶段进度；done → 结果；error → 三态报错 */
function onEvent(event: TaskEvent): void {
  if (event.taskId !== currentTaskId) return
  if (event.kind === 'progress') {
    progress.value = {
      current: event.current,
      total: event.total ?? files.value.length,
      stage: event.stage ?? '',
      message: event.message ?? ''
    }
    return
  }
  if (event.kind === 'log') return
  detach()
  progress.value = null
  if (event.kind === 'done') {
    if (activeTask.value === 'split') {
      splitResult.value = (event.result as SplitResult | undefined) ?? null
    } else {
      result.value = (event.result as StitchResult | undefined) ?? null
    }
    phase.value = 'idle'
    return
  }
  if (event.error.code === 'CANCELLED') {
    phase.value = 'idle'
    return
  }
  error.value = event.error
  phase.value = 'error'
}

async function start(): Promise<void> {
  if (!canStart.value) return
  detach()
  currentTaskId = ''
  activeTask.value = 'stitch'
  phase.value = 'running'
  error.value = null
  result.value = null
  splitResult.value = null
  progress.value = { current: 0, total: files.value.length, stage: 'measure', message: '准备处理…' }
  const payload: StitchPayload = {
    inputPaths: files.value.map((item) => item.path),
    layout: layout.value,
    encoder: encoder.value,
    quality: quality.value,
    bgColor: bgColor.value,
    outputDir: outputDir.value
  }
  try {
    const { taskId } = await submitStitch(payload)
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    setError(err)
  }
}

async function startSplit(): Promise<void> {
  const picked = splitFile.value
  if (!canSplit.value || picked === null) return
  detach()
  currentTaskId = ''
  activeTask.value = 'split'
  phase.value = 'running'
  error.value = null
  result.value = null
  splitResult.value = null
  progress.value = { current: 0, total: 1, stage: 'read', message: '准备处理…' }
  const payload: SplitPayload = {
    inputPath: picked.path,
    mode: splitMode.value,
    height: splitHeight.value,
    parts: splitParts.value,
    quality: splitQuality.value,
    outputDir: outputDir.value
  }
  try {
    const { taskId } = await split(payload)
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    setError(err)
  }
}

async function onCancel(): Promise<void> {
  if (currentTaskId === '') return
  try {
    await cancelTask(currentTaskId)
  } catch (err) {
    setError(err)
  }
}

function resetBatch(): void {
  detach()
  clearFiles()
  removeSplitFile()
  result.value = null
  splitResult.value = null
  error.value = null
  progress.value = null
  phase.value = 'idle'
}

function retry(): void {
  if (activeTask.value === 'split') {
    void startSplit()
    return
  }
  void start()
}

/** 单张长图选择（体积极限同拼接） */
function addSplitFile(payload: { file: File; path: string }): void {
  invalidHint.value = ''
  if (payload.file.size > MAX_IMAGE_BYTES) {
    invalidHint.value = `图片超过 40MB，已跳过：${payload.file.name}`
    return
  }
  removeSplitFile()
  splitFile.value = {
    file: payload.file,
    path: payload.path,
    url: URL.createObjectURL(payload.file),
    size: payload.file.size
  }
}

function removeSplitFile(): void {
  if (splitFile.value !== null) URL.revokeObjectURL(splitFile.value.url)
  splitFile.value = null
  splitResult.value = null
}

/** 系统目录选择：选中回填并记忆；取消保持原值 */
async function chooseDir(): Promise<void> {
  try {
    const dir = await pickDirectory('选择输出目录')
    if (dir === null) return
    const saved = await setOutputDir({ outputDir: dir })
    outputDir.value = saved.outputDir
  } catch (err) {
    setError(err)
  }
}

function reveal(): void {
  if (result.value !== null) void revealPath(result.value.outputPath)
}

onMounted(async () => {
  try {
    const conf = await config()
    outputDir.value = conf.outputDir
  } catch {
    // 读取记忆目录失败不阻断：用户仍可手动选择
  }
})

onUnmounted(() => {
  detach()
  if (previewTimer !== undefined) window.clearTimeout(previewTimer)
  clearFiles()
  removeSplitFile()
})
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <header class="flex flex-col gap-1">
      <h2 class="text-lg font-semibold text-[var(--lumin-color-text)]">图片拼接与分割</h2>
      <p class="text-sm text-[var(--lumin-color-text-secondary)]">
        多张图片拼成纵向/横向长图或网格拼图，或把一张长图按高度/份数切段，原图不修改，全程离线
      </p>
    </header>

    <!-- 页签：拼接 / 长图分割（M40） -->
    <NTabs v-model:value="activeTab" type="line">
      <NTabPane name="stitch">
        <template #tab>拼接</template>
      </NTabPane>
      <NTabPane name="split">
        <template #tab>长图分割</template>
      </NTabPane>
    </NTabs>

    <template v-if="activeTab === 'stitch'">

    <DropZone
      v-if="files.length === 0"
      :accept="ACCEPT"
      multiple
      hint="拖拽图片到此处，或点击选择（可多选）"
      @select="addFile"
      @invalid="(reason: string) => (invalidHint = reason)"
    />
    <p v-if="files.length === 0" class="text-xs text-[var(--lumin-color-text-secondary)]">
      支持 PNG / JPG / WebP，单次最多 {{ MAX_IMAGES }} 张，单张不超过 40MB。
    </p>

    <p v-if="invalidHint !== ''" class="text-sm text-[var(--lumin-color-error)]">
      {{ invalidHint }}
    </p>

    <template v-if="files.length > 0">
      <section class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-sm text-[var(--lumin-color-text)]">已选 {{ files.length }} 张</span>
          <NButton size="small" quaternary @click="clearFiles">
            <template #icon><Trash2 :size="14" /></template>
            清空
          </NButton>
        </div>
        <ul class="flex max-h-48 flex-col gap-1 overflow-auto">
          <li
            v-for="(item, index) in files"
            :key="item.path"
            class="flex items-center gap-2 rounded-[var(--lumin-radius-sm)] border border-[var(--lumin-color-border)] px-2 py-1"
          >
            <img
              :src="item.url"
              :alt="item.file.name"
              class="h-8 w-8 rounded-[var(--lumin-radius-sm)] object-cover"
            />
            <span class="flex-1 truncate text-sm text-[var(--lumin-color-text)]">
              {{ item.file.name }}
            </span>
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">
              {{ formatSize(item.size) }}
            </span>
            <NButton size="tiny" quaternary @click="removeFile(index)">
              <template #icon><X :size="12" /></template>
            </NButton>
          </li>
        </ul>
        <DropZone
          v-if="files.length < MAX_IMAGES"
          :accept="ACCEPT"
          multiple
          hint="继续添加图片"
          @select="addFile"
          @invalid="(reason: string) => (invalidHint = reason)"
        />
      </section>

      <section class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <span class="text-sm text-[var(--lumin-color-text)]">布局模式</span>
          <NRadioGroup v-model:value="mode">
            <NRadio v-for="item in (Object.keys(MODE_LABELS) as StitchMode[])" :key="item" :value="item">
              {{ MODE_LABELS[item] }}
            </NRadio>
          </NRadioGroup>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-sm text-[var(--lumin-color-text)]">基准尺寸</span>
          <div class="flex flex-wrap items-center gap-3">
            <NRadioGroup v-model:value="sizeMode">
              <NRadio
                v-for="item in (Object.keys(SIZE_MODE_LABELS) as SizeMode[])"
                :key="item"
                :value="item"
              >
                {{ SIZE_MODE_LABELS[item] }}
              </NRadio>
            </NRadioGroup>
            <NInputNumber
              v-if="sizeMode === 'fixed'"
              v-model:value="fixedSize"
              :min="LIMITS.minFixedSize"
              :max="LIMITS.maxFixedSize"
              :step="100"
              class="max-w-32"
            >
              <template #suffix>px</template>
            </NInputNumber>
          </div>
        </div>

        <div v-if="mode === 'grid'" class="flex items-center gap-3">
          <span class="w-24 shrink-0 text-sm text-[var(--lumin-color-text)]">列数</span>
          <NInputNumber
            v-model:value="columns"
            :min="LIMITS.minColumns"
            :max="LIMITS.maxColumns"
            class="max-w-32"
          />
        </div>

        <div class="flex items-center gap-3">
          <span class="w-24 shrink-0 text-sm text-[var(--lumin-color-text)]">间距 {{ gutter }}px</span>
          <NSlider v-model:value="gutter" :min="0" :max="LIMITS.maxGutter" :step="1" />
        </div>

        <div class="flex items-center gap-3">
          <span class="w-24 shrink-0 text-sm text-[var(--lumin-color-text)]">
            外边距 {{ padding }}px
          </span>
          <NSlider v-model:value="padding" :min="0" :max="LIMITS.maxPadding" :step="1" />
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-sm text-[var(--lumin-color-text)]">背景色</span>
          <NColorPicker v-model:value="bgColor" :show-alpha="false" class="max-w-40" />
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-sm text-[var(--lumin-color-text)]">输出格式</span>
          <NRadioGroup v-model:value="encoder">
            <NRadio
              v-for="item in (Object.keys(ENCODER_LABELS) as ImageEncoder[])"
              :key="item"
              :value="item"
            >
              {{ ENCODER_LABELS[item] }}
            </NRadio>
          </NRadioGroup>
        </div>

        <div class="flex items-center gap-3">
          <span class="w-24 shrink-0 text-sm text-[var(--lumin-color-text)]">质量 {{ quality }}</span>
          <NSlider
            v-model:value="quality"
            :min="LIMITS.minQuality"
            :max="LIMITS.maxQuality"
            :step="1"
            :disabled="encoder === 'png'"
          />
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <span class="text-sm text-[var(--lumin-color-text)]">预览</span>
        <canvas
          ref="previewCanvas"
          class="max-w-full rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)]"
        />
        <span class="text-xs text-[var(--lumin-color-text-secondary)]">{{ planLabel }}</span>
      </section>

      <section class="flex items-center gap-2">
        <NInput :value="outputDir" readonly placeholder="输出目录" class="flex-1" />
        <NButton @click="chooseDir">
          <template #icon><FolderOpen :size="16" /></template>
          选择目录
        </NButton>
      </section>

      <div class="flex flex-wrap items-center gap-2">
        <NButton type="primary" :disabled="!canStart" @click="start">
          <template #icon><Plus :size="16" /></template>
          开始拼接
        </NButton>
        <NButton v-if="result !== null" quaternary @click="resetBatch">再处理一批</NButton>
      </div>

      <TaskProgress
        v-if="phase === 'running' && progress !== null"
        :message="progressMessage"
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
          <NButton quaternary @click="resetBatch">返回重新选择</NButton>
        </div>
      </template>

      <template v-if="phase === 'idle' && result !== null">
        <NAlert
          type="success"
          :title="`已生成 ${result.width} × ${result.height} · ${result.count} 张图`"
        />
        <div class="break-all">
          <PathLink :path="result.outputPath" :reveal="false" />
        </div>
        <div class="flex gap-2">
          <NButton quaternary @click="reveal">
            <template #icon><FolderOpen :size="16" /></template>
            打开输出目录
          </NButton>
          <NButton quaternary @click="retry">
            <template #icon><RefreshCw :size="16" /></template>
            再拼一次
          </NButton>
        </div>
      </template>
    </template>
    </template>

    <!-- 长图分割（M40，spec §3.6/§5） -->
    <template v-else>
      <DropZone
        v-if="splitFile === null"
        :accept="ACCEPT"
        hint="拖入一张长图，或点击选择"
        @select="addSplitFile"
        @invalid="(reason: string) => (invalidHint = reason)"
      />
      <p
        v-if="splitFile === null"
        class="text-xs text-[var(--lumin-color-text-secondary)]"
      >
        支持 PNG / JPG / WebP，单张不超过 40MB；按固定高度或按份数切分，输出沿用原格式。
      </p>

      <p v-if="invalidHint !== ''" class="text-sm text-[var(--lumin-color-error)]">
        {{ invalidHint }}
      </p>

      <template v-if="splitFile !== null">
        <section class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-sm text-[var(--lumin-color-text)]">已选 1 张</span>
            <NButton size="small" quaternary @click="removeSplitFile">
              <template #icon><Trash2 :size="14" /></template>
              清空
            </NButton>
          </div>
          <div
            class="flex items-center gap-2 rounded-[var(--lumin-radius-sm)] border border-[var(--lumin-color-border)] px-2 py-1"
          >
            <img
              :src="splitFile.url"
              :alt="splitFile.file.name"
              class="h-8 w-8 rounded-[var(--lumin-radius-sm)] object-cover"
            />
            <span class="flex-1 truncate text-sm text-[var(--lumin-color-text)]">
              {{ splitFile.file.name }}
            </span>
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">
              {{ formatSize(splitFile.size) }}
            </span>
            <NButton size="tiny" quaternary @click="removeSplitFile">
              <template #icon><X :size="12" /></template>
            </NButton>
          </div>
        </section>

        <section class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <span class="text-sm text-[var(--lumin-color-text)]">切分方式</span>
            <NRadioGroup v-model:value="splitMode" data-testid="split-mode">
              <NRadio value="height">按固定高度</NRadio>
              <NRadio value="parts">按份数</NRadio>
            </NRadioGroup>
          </div>

          <div v-if="splitMode === 'height'" class="flex items-center gap-3">
            <span class="w-24 shrink-0 text-sm text-[var(--lumin-color-text)]">每段高度</span>
            <NInputNumber
              v-model:value="splitHeight"
              data-testid="split-height"
              :min="SPLIT_LIMITS.minHeight"
              :max="SPLIT_LIMITS.maxHeight"
              :step="100"
              class="max-w-32"
            >
              <template #suffix>px</template>
            </NInputNumber>
          </div>

          <div v-else class="flex items-center gap-3">
            <span class="w-24 shrink-0 text-sm text-[var(--lumin-color-text)]">份数</span>
            <NInputNumber
              v-model:value="splitParts"
              data-testid="split-parts"
              :min="SPLIT_LIMITS.minParts"
              :max="SPLIT_LIMITS.maxParts"
              class="max-w-32"
            />
          </div>

          <div class="flex items-center gap-3">
            <span class="w-24 shrink-0 text-sm text-[var(--lumin-color-text)]">
              质量 {{ splitQuality }}
            </span>
            <NSlider
              v-model:value="splitQuality"
              :min="LIMITS.minQuality"
              :max="LIMITS.maxQuality"
              :step="1"
              :disabled="splitIsLossless"
            />
          </div>
        </section>

        <section class="flex items-center gap-2">
          <NInput :value="outputDir" readonly placeholder="输出目录" class="flex-1" />
          <NButton @click="chooseDir">
            <template #icon><FolderOpen :size="16" /></template>
            选择目录
          </NButton>
        </section>

        <div class="flex flex-wrap items-center gap-2">
          <NButton
            type="primary"
            data-testid="split-run"
            :disabled="!canSplit"
            @click="startSplit"
          >
            <template #icon><Scissors :size="16" /></template>
            开始分割
          </NButton>
          <NButton v-if="splitResult !== null" quaternary @click="resetBatch">
            再处理一张
          </NButton>
        </div>

        <TaskProgress
          v-if="phase === 'running' && progress !== null"
          :message="progressMessage"
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
            <NButton quaternary @click="resetBatch">返回重新选择</NButton>
          </div>
        </template>

        <template v-if="phase === 'idle' && splitResult !== null">
          <NAlert
            data-testid="split-result"
            type="success"
            :title="`已切分 ${splitResult.outputs.length} 段 · 源图 ${splitResult.sourceWidth} × ${splitResult.sourceHeight}`"
          />
          <ul class="flex max-h-48 flex-col gap-1 overflow-auto">
            <li
              v-for="item in splitResult.outputs"
              :key="item.path"
              class="flex items-center justify-between gap-2 rounded-[var(--lumin-radius-sm)] border border-[var(--lumin-color-border)] px-2 py-1"
            >
              <PathLink :path="item.path" :reveal="false" class="flex-1" />
              <span class="shrink-0 text-xs text-[var(--lumin-color-text-secondary)]">
                {{ item.width }} × {{ item.height }}
              </span>
            </li>
          </ul>
          <div class="flex gap-2">
            <NButton
              v-if="splitResult.outputs.length > 0"
              quaternary
              @click="revealPath(splitResult.outputs[0]?.path ?? '')"
            >
              <template #icon><FolderOpen :size="16" /></template>
              打开输出目录
            </NButton>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>
