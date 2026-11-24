<script setup lang="ts">
/**
 * @file ToolView.vue 图片去水印工具页（框选 + 三模式填充 + 三态）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 原图预览上拖拽框选（新建/选中/移动/删除），快速修复/模糊/纯色填充；
 *              提交 image-dewatermark:dewatermark 长任务，展示进度、可取消、结构化报错与产物。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NAlert, NButton, NInput, NRadio, NRadioGroup, NSlider } from 'naive-ui'
import { Eraser, FolderOpen, RefreshCw, Trash2, X } from '@lucide/vue'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import type { StructuredError, TaskEvent } from '@lumin/shared'
import {
  MAX_DIMENSION,
  MAX_IMAGE_BYTES,
  MAX_REGIONS,
  MIN_BLUR_RADIUS,
  MAX_BLUR_RADIUS,
  DEFAULT_BLUR_RADIUS,
  type DewatermarkResult,
  type FillMode,
  type Region
} from '../schema'
import {
  moveRegion,
  normalizeDraftRegion,
  rectToPercent,
  toImagePoint,
  type Point
} from '../contract'
import { isRetryable } from '../errors'
import {
  cancelTask,
  config,
  pickDirectory,
  revealPath,
  setOutputDir,
  submitDewatermark
} from './client'

/** 已选中图片（原始尺寸用于坐标换算） */
interface SelectedImage {
  path: string
  url: string
  width: number
  height: number
}

/** 指针拖拽状态：新建框 或 移动已有区域 */
type DragState =
  | { kind: 'create'; start: Point; current: Point }
  | { kind: 'move'; index: number; start: Point; origin: Region }

/** 界面态 */
const phase = ref<'idle' | 'running'>('idle')
const image = ref<SelectedImage | null>(null)
const regions = ref<Region[]>([])
const selectedIndex = ref(-1)
const mode = ref<FillMode>('inpaint')
const blurRadius = ref(DEFAULT_BLUR_RADIUS)
const outputDir = ref('')
const drag = ref<DragState | null>(null)
const stage = ref<HTMLDivElement | null>(null)
const progress = ref<{ current: number; total: number; message: string } | null>(null)
const error = ref<StructuredError | null>(null)
const hint = ref('')
const result = ref<DewatermarkResult | null>(null)
let taskId: string | null = null
let offTaskEvent: (() => void) | null = null

/** 空态 / 顶部提示（跳过或不支持的文件） */
const notice = ref('')

const hasImage = computed(() => image.value !== null)
const previewUrl = computed(() => image.value?.url ?? '')
const running = computed(() => phase.value === 'running')
const canStart = computed(
  () => image.value !== null && regions.value.length > 0 && outputDir.value !== '' && !running.value
)

/** 加载预览图，拿到原始宽高 */
function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('预览加载失败'))
    element.src = url
  })
}

/** DropZone 选中/拖入单张图片 */
async function onPicked(payload: { file: File; path: string }): Promise<void> {
  notice.value = ''
  error.value = null
  result.value = null
  if (payload.file.size > MAX_IMAGE_BYTES) {
    notice.value = `图片超过 40MB，已跳过：${payload.file.name}`
    return
  }
  const url = URL.createObjectURL(payload.file)
  try {
    const element = await loadHtmlImage(url)
    if (element.naturalWidth > MAX_DIMENSION || element.naturalHeight > MAX_DIMENSION) {
      URL.revokeObjectURL(url)
      notice.value = `图片尺寸超过 ${MAX_DIMENSION}×${MAX_DIMENSION}，无法处理`
      return
    }
    if (image.value !== null) URL.revokeObjectURL(image.value.url)
    image.value = {
      path: payload.path,
      url,
      width: element.naturalWidth,
      height: element.naturalHeight
    }
    regions.value = []
    selectedIndex.value = -1
  } catch {
    URL.revokeObjectURL(url)
    notice.value = '图片无法读取，请更换文件'
  }
}

/** 类型不符时提示 */
function onInvalid(reason: string): void {
  notice.value = reason
}

/** 清空当前图片与区域（保留输出目录） */
function resetImage(): void {
  if (image.value !== null) URL.revokeObjectURL(image.value.url)
  image.value = null
  regions.value = []
  selectedIndex.value = -1
  drag.value = null
  result.value = null
  error.value = null
  progress.value = null
  notice.value = ''
}

/** 指针位置 → 原图坐标 */
function pointFromEvent(event: PointerEvent): Point | null {
  const element = stage.value
  const current = image.value
  if (element === null || current === null) return null
  const box = element.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return null
  return toImagePoint(
    { x: event.clientX - box.left, y: event.clientY - box.top },
    { width: box.width, height: box.height },
    { width: current.width, height: current.height }
  )
}

/** 命中测试：倒序查找包含该点的区域 */
function hitRegion(point: Point): number {
  for (let index = regions.value.length - 1; index >= 0; index--) {
    const region = regions.value[index]
    if (region === undefined) continue
    if (
      point.x >= region.x &&
      point.x <= region.x + region.width &&
      point.y >= region.y &&
      point.y <= region.y + region.height
    ) {
      return index
    }
  }
  return -1
}

/** 按下：命中区域 → 选中并移动；空白 → 新建框 */
function onPointerDown(event: PointerEvent): void {
  if (image.value === null || running.value || event.button !== 0) return
  const point = pointFromEvent(event)
  if (point === null) return
  event.preventDefault()
  stage.value?.setPointerCapture(event.pointerId)
  const hit = hitRegion(point)
  if (hit >= 0) {
    const region = regions.value[hit]
    if (region === undefined) return
    selectedIndex.value = hit
    drag.value = { kind: 'move', index: hit, start: point, origin: { ...region } }
  } else {
    selectedIndex.value = -1
    drag.value = { kind: 'create', start: point, current: point }
  }
}

/** 拖动：更新新建框或移动区域 */
function onPointerMove(event: PointerEvent): void {
  const state = drag.value
  const current = image.value
  if (state === null || current === null) return
  const point = pointFromEvent(event)
  if (point === null) return
  if (state.kind === 'create') {
    state.current = point
  } else {
    const moved = moveRegion(
      state.origin,
      point.x - state.start.x,
      point.y - state.start.y,
      current.width,
      current.height
    )
    regions.value[state.index] = moved
  }
}

/** 松开：提交新建框（≥2×2 且未超上限） */
function onPointerUp(event: PointerEvent): void {
  const state = drag.value
  drag.value = null
  if (stage.value?.hasPointerCapture(event.pointerId) === true) {
    stage.value.releasePointerCapture(event.pointerId)
  }
  const current = image.value
  if (state === null || state.kind !== 'create' || current === null) return
  const rect = normalizeDraftRegion(state.start, state.current, current.width, current.height)
  if (rect === null) return
  if (regions.value.length >= MAX_REGIONS) {
    notice.value = `最多框选 ${MAX_REGIONS} 个区域`
    return
  }
  regions.value.push(rect)
  selectedIndex.value = regions.value.length - 1
}

/** 实时草稿框（新建中） */
const draftRect = computed<Region | null>(() => {
  const state = drag.value
  const current = image.value
  if (state === null || state.kind !== 'create' || current === null) return null
  return normalizeDraftRegion(state.start, state.current, current.width, current.height)
})

/** 区域框百分比定位 + tokens 配色 */
function boxStyle(region: Region, active: boolean): Record<string, string> {
  const current = image.value
  if (current === null) return {}
  const percent = rectToPercent(region, { width: current.width, height: current.height })
  const token = active ? 'var(--lumin-color-primary)' : 'var(--lumin-color-error)'
  return {
    left: `${percent.left}%`,
    top: `${percent.top}%`,
    width: `${percent.width}%`,
    height: `${percent.height}%`,
    borderColor: token,
    background: `color-mix(in srgb, ${token} 16%, transparent)`
  }
}

/** 删除指定区域并修正选中项 */
function removeRegion(index: number): void {
  regions.value.splice(index, 1)
  if (selectedIndex.value === index) selectedIndex.value = regions.value.length - 1
  else if (selectedIndex.value > index) selectedIndex.value -= 1
}

/** 清空全部区域 */
function clearRegions(): void {
  regions.value = []
  selectedIndex.value = -1
}

/** 选择输出目录并记忆 */
async function chooseOutputDir(): Promise<void> {
  try {
    const picked = await pickDirectory('选择去水印输出目录')
    if (picked === null) return
    const response = await setOutputDir({ outputDir: picked })
    outputDir.value = response.outputDir
  } catch (err) {
    error.value = normalizeError(err)
  }
}

/** 任意异常 → 界面错误结构 */
function normalizeError(err: unknown): StructuredError {
  if (typeof err === 'object' && err !== null && 'code' in err && 'message' in err) {
    return err as StructuredError
  }
  return {
    code: 'UNKNOWN',
    message: '操作失败，请重试',
    detail: err instanceof Error ? err.message : String(err)
  }
}

/** 开始去水印 */
async function start(): Promise<void> {
  const current = image.value
  if (current === null || !canStart.value) return
  phase.value = 'running'
  error.value = null
  result.value = null
  hint.value = ''
  progress.value = { current: 0, total: regions.value.length, message: '正在准备…' }
  try {
    const response = await submitDewatermark({
      inputPath: current.path,
      regions: regions.value.map((region) => ({ ...region })),
      mode: mode.value,
      blurRadius: blurRadius.value,
      outputDir: outputDir.value
    })
    taskId = response.taskId
  } catch (err) {
    phase.value = 'idle'
    progress.value = null
    error.value = normalizeError(err)
  }
}

/** 取消当前任务 */
async function cancel(): Promise<void> {
  if (taskId === null) return
  try {
    await cancelTask(taskId)
  } catch (err) {
    error.value = normalizeError(err)
  }
}

/** 任务事件：仅处理当前 taskId */
function onTaskEvent(event: TaskEvent): void {
  if (taskId === null || event.taskId !== taskId) return
  if (event.kind === 'progress') {
    progress.value = {
      current: event.current,
      total: event.total ?? regions.value.length,
      message: event.message ?? '处理中…'
    }
    return
  }
  if (event.kind === 'done') {
    phase.value = 'idle'
    progress.value = null
    taskId = null
    result.value = event.result as DewatermarkResult
    return
  }
  if (event.kind === 'error') {
    phase.value = 'idle'
    progress.value = null
    taskId = null
    if (event.error.code === 'CANCELLED') {
      hint.value = '已取消，图片与区域已保留'
      return
    }
    error.value = event.error
  }
}

/** 再次处理同一张图（保留区域） */
function retry(): void {
  error.value = null
  void start()
}

onMounted(async () => {
  offTaskEvent = window.lumin.onTaskEvent(onTaskEvent)
  try {
    const response = await config()
    outputDir.value = response.outputDir
  } catch (err) {
    error.value = normalizeError(err)
  }
})

onUnmounted(() => {
  offTaskEvent?.()
  if (image.value !== null) URL.revokeObjectURL(image.value.url)
})
</script>

<template>
  <section class="mx-auto flex w-full max-w-4xl flex-col gap-5">
    <header class="flex flex-col gap-1">
      <h1 class="flex items-center gap-2 text-xl font-semibold text-[var(--lumin-color-text)]">
        <Eraser class="size-5 text-[var(--lumin-color-primary)]" />
        图片去水印
      </h1>
      <p class="text-sm text-[var(--lumin-color-text-secondary)]">
        框选水印区域后自动填充，原图不修改，全程离线。
      </p>
    </header>

    <NAlert v-if="notice" type="warning" :bordered="false" closable @close="notice = ''">
      {{ notice }}
    </NAlert>

    <template v-if="!hasImage">
      <DropZone
        accept=".png,.jpg,.jpeg,.webp"
        hint="拖拽图片到此处，或点击选择"
        :disabled="running"
        @select="onPicked"
        @invalid="onInvalid"
      />
      <p class="text-xs text-[var(--lumin-color-text-tertiary)]">
        支持 PNG / JPG / WebP，单张不超过 40MB，尺寸不超过 10000×10000。
      </p>
    </template>

    <template v-else>
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm text-[var(--lumin-color-text-secondary)]">
          已框选 {{ regions.length }}/{{ MAX_REGIONS }} 个区域；在图片上拖拽新增，按住区域可移动。
        </p>
        <div class="flex items-center gap-2">
          <NButton size="small" quaternary :disabled="running" @click="resetImage">
            更换图片
          </NButton>
          <NButton
            size="small"
            quaternary
            :disabled="running || regions.length === 0"
            @click="clearRegions"
          >
            清空区域
          </NButton>
        </div>
      </div>

      <div
        class="max-h-[70vh] overflow-auto rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface-muted)]"
      >
        <div
          ref="stage"
          data-testid="dewatermark-stage"
          class="relative block w-full touch-none select-none"
          :class="running ? 'cursor-not-allowed' : 'cursor-crosshair'"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <img
            :src="previewUrl"
            alt="待处理图片预览"
            class="block h-auto w-full"
            draggable="false"
          />
          <div
            v-for="(region, index) in regions"
            :key="`region-${index}`"
            class="pointer-events-none absolute border-2"
            :style="boxStyle(region, index === selectedIndex)"
          >
            <span
              class="absolute -top-5 left-0 rounded-t bg-[var(--lumin-color-primary)] px-1.5 text-xs leading-4 text-[var(--lumin-color-primary-contrast)]"
            >
              #{{ index + 1 }}
            </span>
          </div>
          <div
            v-if="draftRect"
            class="pointer-events-none absolute border-2 border-dashed border-[var(--lumin-color-primary)] bg-[var(--lumin-color-primary-soft)] opacity-60"
            :style="boxStyle(draftRect, true)"
          />
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-2">
            <span class="text-sm text-[var(--lumin-color-text-secondary)]">填充模式</span>
            <NRadioGroup v-model:value="mode" :disabled="running">
              <NRadio value="inpaint">快速修复</NRadio>
              <NRadio value="blur">模糊</NRadio>
              <NRadio value="solid">纯色</NRadio>
            </NRadioGroup>
          </div>
          <div v-if="mode === 'blur'" class="flex flex-col gap-1">
            <span class="text-sm text-[var(--lumin-color-text-secondary)]">
              模糊半径：{{ blurRadius }}px
            </span>
            <NSlider
              v-model:value="blurRadius"
              :min="MIN_BLUR_RADIUS"
              :max="MAX_BLUR_RADIUS"
              :step="1"
              :disabled="running"
            />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-sm text-[var(--lumin-color-text-secondary)]">输出目录</span>
            <div class="flex items-center gap-2">
              <NInput :value="outputDir" readonly placeholder="尚未选择输出目录" />
              <NButton :disabled="running" @click="chooseOutputDir">
                <template #icon><FolderOpen class="size-4" /></template>
                选择
              </NButton>
            </div>
          </div>
        </div>

        <div class="flex max-h-52 flex-col gap-2 overflow-auto">
          <div
            v-for="(region, index) in regions"
            :key="`item-${index}`"
            class="flex cursor-pointer items-center justify-between gap-2 rounded-[var(--lumin-radius-md)] border px-3 py-2 text-sm"
            :class="
              index === selectedIndex
                ? 'border-[var(--lumin-color-primary)] bg-[var(--lumin-color-primary-soft)]'
                : 'border-[var(--lumin-color-border)]'
            "
            @click="selectedIndex = index"
          >
            <span class="text-[var(--lumin-color-text)]">#{{ index + 1 }}</span>
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">
              {{ region.x }}, {{ region.y }} · {{ region.width }}×{{ region.height }}
            </span>
            <NButton size="tiny" quaternary :disabled="running" @click.stop="removeRegion(index)">
              <template #icon><X class="size-3.5" /></template>
            </NButton>
          </div>
          <p v-if="regions.length === 0" class="text-sm text-[var(--lumin-color-text-tertiary)]">
            尚未框选区域，请在图片上拖拽框选水印。
          </p>
          <NButton
            v-if="selectedIndex >= 0 && selectedIndex < regions.length"
            size="small"
            quaternary
            type="error"
            :disabled="running"
            @click="removeRegion(selectedIndex)"
          >
            <template #icon><Trash2 class="size-4" /></template>
            删除选中
          </NButton>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <NButton
          type="primary"
          size="large"
          data-testid="dewatermark-start"
          :loading="running"
          :disabled="!canStart"
          @click="start"
        >
          <template #icon><Eraser class="size-4" /></template>
          开始去水印
        </NButton>

        <TaskProgress
          v-if="progress"
          :current="progress.current"
          :total="progress.total"
          :message="progress.message"
          :cancellable="running"
          @cancel="cancel"
        />

        <p v-if="hint" class="text-sm text-[var(--lumin-color-text-secondary)]">{{ hint }}</p>

        <NAlert v-if="error" type="error" :bordered="false">
          <div class="flex flex-col gap-1">
            <span class="text-sm">{{ error.message }}（{{ error.code }}）</span>
            <span v-if="error.detail" class="text-xs opacity-80">{{ error.detail }}</span>
            <div class="flex gap-2 pt-1">
              <NButton v-if="isRetryable(error.code)" size="small" @click="retry">
                <template #icon><RefreshCw class="size-3.5" /></template>
                重试
              </NButton>
              <NButton v-else size="small" @click="resetImage">重新选择图片</NButton>
            </div>
          </div>
        </NAlert>

        <NAlert v-if="result" type="success" :bordered="false">
          <div class="flex flex-col gap-2">
            <span class="text-sm text-[var(--lumin-color-text)]">已生成：{{ result.output }}</span>
            <span
              v-for="warning in result.warnings"
              :key="warning"
              class="text-xs text-[var(--lumin-color-text-secondary)]"
            >
              {{ warning }}
            </span>
            <div class="flex gap-2">
              <NButton size="small" @click="revealPath(result.output)">
                <template #icon><FolderOpen class="size-3.5" /></template>
                打开输出目录
              </NButton>
              <NButton size="small" quaternary @click="resetImage">再处理一张</NButton>
            </div>
          </div>
        </NAlert>
      </div>
    </template>
  </section>
</template>
