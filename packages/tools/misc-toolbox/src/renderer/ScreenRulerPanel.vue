<script setup lang="ts">
/**
 * 实用工具 · 屏幕标尺：截屏后在预览层拖拽框选，实时读取像素尺寸与 cm/inch 换算。
 * 三态：空态（DPI 引导 + 开始测量）/ 加载态（截屏按钮 loading）/ 报错态（MT_* 结构化错误 + 重试）。
 * 截屏能力经 misc-toolbox:capture-display（复用 node-kit 公共实现），预览层内仅做纯函数测量。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NAlert, NButton, NInputNumber, NSelect, NText } from 'naive-ui'
import { Copy, RotateCcw, Ruler } from '@lucide/vue'
import { mapPointToPixel, toStructuredError, type StructuredError } from '@lumin/shared'

import { errorMessage, toolError } from '../errors'
import type { CaptureDisplayResult } from '../schema'
import {
  DEFAULT_DPI,
  MAX_DPI,
  MIN_DPI,
  isValidDpi,
  measureRect,
  normalizeRect,
  rulerSummary,
  type RulerPoint
} from '../ruler'
import { captureDisplay } from './client'

const dpi = ref<number | null>(DEFAULT_DPI)
const capture = ref<CaptureDisplayResult | null>(null)
const capturing = ref(false)
const error = ref<StructuredError | null>(null)
const startPoint = ref<RulerPoint | null>(null)
const currentPoint = ref<RulerPoint | null>(null)
const dragging = ref(false)
const copied = ref(false)

const imageRef = ref<HTMLImageElement | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const overlayVisible = computed(() => capture.value !== null)

const displayOptions = computed<readonly { label: string; value: string }[]>(() =>
  capture.value === null
    ? []
    : capture.value.displays.map((item) => ({ label: item.label, value: item.id }))
)

const selection = computed(() =>
  startPoint.value !== null && currentPoint.value !== null
    ? normalizeRect(startPoint.value, currentPoint.value)
    : null
)

const metrics = computed(() => {
  const rect = selection.value
  const current = capture.value
  if (rect === null || current === null || !isValidDpi(dpi.value)) return null
  return measureRect(rect, dpi.value, current.scaleFactor)
})

const scalePercent = computed(() =>
  capture.value === null ? 100 : Math.round(capture.value.scaleFactor * 100)
)

async function start(displayId?: string): Promise<void> {
  if (capturing.value) return
  error.value = null
  copied.value = false
  if (!isValidDpi(dpi.value)) {
    error.value = toolError('MT_RULER_INVALID', `DPI 需在 ${MIN_DPI}–${MAX_DPI} 之间`)
    return
  }
  capturing.value = true
  try {
    capture.value = await captureDisplay(displayId === undefined ? {} : { displayId })
    resetSelection()
  } catch (err) {
    capture.value = null
    error.value = toolError('MT_CAPTURE_FAILED', toStructuredError(err).message)
  } finally {
    capturing.value = false
  }
}

function closeOverlay(): void {
  capture.value = null
  error.value = null
  resetSelection()
}

function resetSelection(): void {
  startPoint.value = null
  currentPoint.value = null
  dragging.value = false
  copied.value = false
}

function onDisplayChange(value: string | number): void {
  if (typeof value !== 'string' || value === capture.value?.displayId) return
  void start(value)
}

/** 客户端坐标 → 截图原始像素（越界夹紧到最近边缘，便于拖出图片后继续跟随） */
function clientToPixel(event: PointerEvent): RulerPoint | null {
  const image = imageRef.value
  const current = capture.value
  if (image === null || current === null) return null
  const rect = image.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const x = Math.min(Math.max(event.clientX, rect.left), rect.right - 1)
  const y = Math.min(Math.max(event.clientY, rect.top), rect.bottom - 1)
  return mapPointToPixel(
    { x, y },
    { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    { width: current.width, height: current.height }
  )
}

function onPointerDown(event: PointerEvent): void {
  const pixel = clientToPixel(event)
  if (pixel === null) return
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  startPoint.value = pixel
  currentPoint.value = pixel
  dragging.value = true
  copied.value = false
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  const pixel = clientToPixel(event)
  if (pixel !== null) currentPoint.value = pixel
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  if (
    event.currentTarget instanceof HTMLElement &&
    event.currentTarget.hasPointerCapture(event.pointerId)
  ) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const rect = selection.value
  if (rect !== null && rect.width === 0 && rect.height === 0) resetSelection()
}

async function copyResult(): Promise<void> {
  const current = metrics.value
  if (current === null) return
  try {
    await navigator.clipboard.writeText(rulerSummary(current))
    copied.value = true
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1200)
  } catch (err) {
    error.value = toolError('MT_CLIPBOARD_FAILED', toStructuredError(err).message)
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && overlayVisible.value) closeOverlay()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <NText depth="3" class="text-sm">
      截取屏幕后在预览中拖拽框选区域，实时读取宽高、对角线与 cm / inch 换算。开始前建议先把 Lumin
      窗口移开或最小化，避免遮挡要测量的区域。
    </NText>

    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <NText depth="2" class="text-sm">名义 DPI</NText>
        <NInputNumber
          v-model:value="dpi"
          :min="MIN_DPI"
          :max="MAX_DPI"
          :step="1"
          class="w-32"
          aria-label="名义 DPI"
        />
      </div>
      <NButton type="primary" data-testid="ruler-start" :loading="capturing" @click="start()">
        <Ruler class="mr-1 h-4 w-4" />开始测量
      </NButton>
      <NText depth="3" class="text-xs">DPI 仅用于 cm / inch 名义换算，默认 96</NText>
    </div>

    <NAlert v-if="!isValidDpi(dpi)" type="warning" :bordered="false">
      DPI 需在 {{ MIN_DPI }}–{{ MAX_DPI }} 之间，超出范围无法换算。
    </NAlert>

    <NAlert v-if="error !== null" type="error" :bordered="false" role="alert">
      {{ errorMessage(error.code) }}（{{ error.code }}）
      <span v-if="error.detail !== undefined" class="ml-1 text-xs opacity-80">
        {{ error.detail }}
      </span>
    </NAlert>

    <NText v-if="capture === null && error === null" depth="3" class="text-sm">
      尚未截屏。点击「开始测量」，再在截图上按住拖拽即可得到像素与物理尺寸。
    </NText>

    <div
      v-if="capture !== null"
      role="dialog"
      aria-modal="true"
      aria-label="屏幕标尺"
      data-testid="ruler-overlay"
      class="fixed inset-0 z-50 flex flex-col gap-3 bg-[var(--lumin-color-surface)] p-4"
    >
      <div class="flex flex-wrap items-center gap-3">
        <p class="text-sm text-[var(--lumin-color-text)]">拖拽框选要测量的区域，Esc 关闭</p>
        <div v-if="capture.displays.length > 1" class="w-48">
          <NSelect
            :value="capture.displayId"
            :options="[...displayOptions]"
            :disabled="capturing"
            aria-label="选择显示器"
            @update:value="onDisplayChange"
          />
        </div>
        <NButton
          size="small"
          :disabled="capturing"
          :loading="capturing"
          @click="start(capture.displayId)"
        >
          重新截屏
        </NButton>
        <NButton size="small" class="ml-auto" @click="closeOverlay">关闭</NButton>
      </div>

      <p v-if="error !== null" role="alert" class="text-sm text-[var(--lumin-color-error)]">
        {{ error.message }}
        <span class="ml-2 text-xs opacity-70">{{ error.code }}</span>
      </p>

      <div class="flex min-h-0 flex-1 items-center justify-center">
        <div class="relative">
          <img
            ref="imageRef"
            data-testid="ruler-image"
            :src="capture.dataUrl"
            alt="屏幕截图，拖拽框选测量区域"
            draggable="false"
            class="block max-h-full max-w-full touch-none cursor-crosshair select-none object-contain"
            @pointerdown.prevent="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          />
          <svg
            v-if="selection !== null"
            class="pointer-events-none absolute inset-0 h-full w-full"
            :viewBox="`0 0 ${capture.width} ${capture.height}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <rect
              :x="selection.x"
              :y="selection.y"
              :width="selection.width"
              :height="selection.height"
              fill="var(--lumin-color-primary)"
              fill-opacity="0.18"
              stroke="var(--lumin-color-primary)"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
            />
          </svg>
        </div>
      </div>

      <div
        data-testid="ruler-metrics"
        class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
      >
        <template v-if="metrics !== null">
          <div class="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <NText class="font-mono">宽 {{ metrics.widthPx }} px</NText>
            <NText class="font-mono">高 {{ metrics.heightPx }} px</NText>
            <NText class="font-mono">对角线 {{ metrics.diagonalPx }} px</NText>
          </div>
          <div class="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <NText depth="2" class="font-mono"
              >{{ metrics.widthCm }} × {{ metrics.heightCm }} cm</NText
            >
            <NText depth="2" class="font-mono"
              >{{ metrics.widthIn }} × {{ metrics.heightIn }} in</NText
            >
            <NText depth="3" class="font-mono text-xs">
              对角线 {{ metrics.diagonalCm }} cm / {{ metrics.diagonalIn }} in
            </NText>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <NText depth="3" class="font-mono text-xs">
              逻辑尺寸 {{ metrics.widthLogicalPx }} × {{ metrics.heightLogicalPx }} px（缩放
              {{ scalePercent }}%）
            </NText>
            <NButton size="tiny" @click="copyResult">
              <Copy class="mr-1 h-3.5 w-3.5" />{{ copied ? '已复制' : '复制结果' }}
            </NButton>
            <NButton size="tiny" quaternary @click="resetSelection">
              <RotateCcw class="mr-1 h-3.5 w-3.5" />清除选区
            </NButton>
          </div>
        </template>
        <NText v-else depth="3" class="text-sm">在截图上拖拽框选区域后显示测量结果</NText>
      </div>
    </div>
  </div>
</template>
