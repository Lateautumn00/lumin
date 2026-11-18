<script setup lang="ts">
/**
 * OCR Tab 右侧面板（spec §10.2/§10.3）：输入 → 识别 → 微调 → 导出。
 * 三态（spec §10.6）：空态 = DropZone + 引导；加载态 = 阶段进度 + 取消；报错态 = 结构化码卡片。
 * `NO_REGIONS` 进入手动模式：按预览 meta 建空页，当前页建整页题区后可加分界线（2026-11-18 决策）。
 */
import { computed, ref, watch } from 'vue'
import { NButton, NInputNumber, NText } from 'naive-ui'
import { FileText } from '@lucide/vue'
import { isRetryable, toolError } from '../errors'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import type { OcrDetectResult, OcrExportPayload, OcrPage, OpResult } from '../schema'
import {
  cancelTask,
  revealPath,
  submitOcrDetect,
  submitOcrExport,
  type SubmitResult
} from './client'
import ErrorCard from './ErrorCard.vue'
import ResultCard from './ResultCard.vue'
import {
  clonePages,
  ensureRegion,
  hasRegions,
  numberRegions,
  toExportPages,
  type NumberedRegion
} from './ocr-edit'
import { useOcrWorkspace } from './ocr-workspace'

/** 报错态显示 [重新选择] 的码（spec §5/§10.5） */
const RESELECT_CODES = new Set([
  'PDF_NOT_FOUND',
  'PDF_LOCKED',
  'PDF_ENCRYPTED',
  'PDF_INVALID',
  'OCR_INPUT_INVALID'
])

/** A4 @ 1.5 渲染像素（preview meta 未到达前的兜底页尺寸） */
const FALLBACK_SIZE = { width: 893, height: 1263 }

const ws = useOcrWorkspace()

const lastRun = ref<'detect' | 'export' | null>(null)
let unsubscribe: (() => void) | null = null
let currentTaskId = ''

const path = computed(() => ws.path.value)
const name = computed(() => ws.name.value)
const pages = computed(() => ws.pages.value)
const running = computed(() => ws.running.value)
const progress = computed(() => ws.progress.value)
const manualMode = computed(() => ws.manualMode.value)
const totalPages = computed(() => ws.totalPages.value)
const outputPaths = computed(() => ws.outputPaths.value)
const invalidHint = computed(() => ws.invalidHint.value)

const startNumber = computed(() => ws.startNumber.value ?? 1)
const startNumberInput = computed<number | null>({
  get: () => ws.startNumber.value,
  set: (value) => {
    ws.startNumber.value = value
  }
})
const exportPdf = computed<boolean>({
  get: () => ws.exportPdf.value,
  set: (value) => {
    ws.exportPdf.value = value
  }
})

const numbered = computed<NumberedRegion[]>(() => numberRegions(pages.value, startNumber.value))
const busy = computed(() => running.value !== null)
const canDetect = computed(() => path.value !== '' && !busy.value)
const canExport = computed(() => !busy.value && hasRegions(pages.value))
const shownError = computed<StructuredError | null>(() => ws.error.value ?? ws.previewError.value)
const errorIsTask = computed(() => ws.error.value !== null)
const regionCount = computed(() => numbered.value.length)

function detach(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  currentTaskId = ''
}

function buildManualPages(): OcrPage[] {
  const total = totalPages.value > 0 ? totalPages.value : 1
  const built: OcrPage[] = Array.from({ length: total }, (_, index) => {
    const pageNumber = index + 1
    const size = ws.pageSizes.value[pageNumber] ?? FALLBACK_SIZE
    return { pageNumber, width: size.width, height: size.height, regions: [] }
  })
  const index = built.findIndex((page) => page.pageNumber === ws.pageNumber.value)
  const target = built[index]
  if (target !== undefined) built[index] = ensureRegion(target)
  return built
}

function enterManualMode(): void {
  ws.manualMode.value = true
  ws.detected.value = []
  ws.pages.value = buildManualPages()
  ws.selected.value = null
  ws.activeRegion.value = null
  ws.adding.value = true
  ws.outputPaths.value = []
}

function handleTaskError(err: StructuredError): void {
  ws.error.value = err
  if (err.code === 'NO_REGIONS') enterManualMode()
}

function setError(err: unknown): void {
  ws.running.value = null
  ws.progress.value = null
  detach()
  handleTaskError(toStructuredError(err))
}

function applyDetect(result: unknown): void {
  const detected = (result as OcrDetectResult | undefined)?.pages ?? []
  if (detected.length === 0) {
    ws.error.value = toolError('NO_REGIONS')
    enterManualMode()
    return
  }
  ws.pages.value = clonePages(detected)
  ws.detected.value = clonePages(detected)
  ws.manualMode.value = false
  ws.error.value = null
  ws.adding.value = false
  ws.selected.value = null
  ws.activeRegion.value = null
  ws.outputPaths.value = []
  const first = ws.pages.value.find((page) => page.regions.length > 0)
  ws.pageNumber.value = first?.pageNumber ?? 1
}

function onEvent(event: TaskEvent): void {
  if (event.taskId !== currentTaskId) return
  if (event.kind === 'progress') {
    ws.progress.value = {
      ...(event.current !== undefined ? { current: event.current } : {}),
      ...(event.total !== undefined ? { total: event.total } : {}),
      message: event.message ?? (event.stage === 'write' ? '正在导出…' : '')
    }
    return
  }
  if (event.kind === 'log') return
  const kind = lastRun.value
  detach()
  ws.running.value = null
  ws.progress.value = null
  if (event.kind === 'done') {
    if (kind === 'detect') {
      applyDetect(event.result)
      return
    }
    const result = event.result as OpResult | undefined
    ws.outputPaths.value = result?.outputPaths ?? []
    return
  }
  if (event.error.code === 'CANCELLED') return
  handleTaskError(event.error)
}

async function submit(kind: 'detect' | 'export'): Promise<SubmitResult> {
  if (kind === 'detect') return submitOcrDetect({ inputPath: path.value })
  const payload: OcrExportPayload = {
    inputPath: path.value,
    startNumber: startNumber.value,
    exportPdf: exportPdf.value,
    pages: toExportPages(pages.value)
  }
  return submitOcrExport(payload)
}

async function run(kind: 'detect' | 'export'): Promise<void> {
  if (busy.value) return
  ws.error.value = null
  lastRun.value = kind
  ws.running.value = kind
  ws.progress.value = { message: kind === 'detect' ? '提交中…' : '正在导出…' }
  try {
    const { taskId } = await submit(kind)
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    setError(err)
  }
}

function retry(): void {
  void run(lastRun.value === 'export' ? 'export' : 'detect')
}

/** NO_REGIONS 错误卡入口：进入添加模式（当前页已有整页题区） */
function manualAdd(): void {
  ws.error.value = null
  ws.adding.value = true
}

async function onCancel(): Promise<void> {
  if (currentTaskId === '') return
  try {
    await cancelTask(currentTaskId)
  } catch (err) {
    setError(err)
  }
}

/** 会话重置（不动输入文件与导出字段） */
function resetSession(): void {
  detach()
  ws.running.value = null
  lastRun.value = null
  ws.progress.value = null
  ws.error.value = null
  ws.pages.value = []
  ws.detected.value = []
  ws.manualMode.value = false
  ws.adding.value = false
  ws.selected.value = null
  ws.activeRegion.value = null
  ws.outputPaths.value = []
  ws.pageNumber.value = 1
  ws.totalPages.value = 0
  ws.pageSizes.value = {}
}

function onSelect(payload: { file: File; path: string }): void {
  resetSession()
  ws.inputFile.value = payload.file
  ws.name.value = payload.file.name
  ws.path.value = payload.path
  ws.previewError.value = null
  ws.invalidHint.value = ''
}

function resetInput(): void {
  resetSession()
  ws.invalidHint.value = ''
  ws.previewError.value = null
  ws.inputFile.value = null
  ws.name.value = ''
  ws.path.value = ''
}

function locate(item: NumberedRegion): void {
  ws.pageNumber.value = item.pageNumber
  ws.activeRegion.value = item.regionIndex
}

/** 再识别一个：清结果卡与题区状态，输入文件与字段保留（spec §10.3） */
function resetForAnother(): void {
  resetSession()
}

async function openFolder(): Promise<void> {
  const first = outputPaths.value[0]
  if (first === undefined) return
  try {
    await revealPath(first)
  } catch (err) {
    setError(err)
  }
}

/** 预览 meta 页数增长时补建手动页（渲染端建页晚于 NO_REGIONS 的兜底） */
watch(totalPages, (count) => {
  if (!ws.manualMode.value) return
  const current = ws.pages.value
  if (count <= current.length) return
  const next = [...current]
  for (let pageNumber = current.length + 1; pageNumber <= count; pageNumber++) {
    const size = ws.pageSizes.value[pageNumber] ?? FALLBACK_SIZE
    next.push({ pageNumber, width: size.width, height: size.height, regions: [] })
  }
  ws.pages.value = next
})

/** 页切换：清选中（不同页边界下标不同） */
watch(
  () => ws.pageNumber.value,
  () => {
    ws.selected.value = null
  }
)

/** 换文件：整体重置（含题号与导出选项） */
watch(
  () => ws.path.value,
  () => {
    resetSession()
    ws.startNumber.value = 1
    ws.exportPdf.value = true
    ws.invalidHint.value = ''
  }
)
</script>

<template>
  <section class="flex min-h-0 flex-col gap-3 overflow-y-auto" aria-label="OCR 切题">
    <!-- 空态：DropZone + 引导（spec §10.6 禁止白屏） -->
    <template v-if="path === ''">
      <DropZone
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        hint="选择试卷图片或 PDF 开始切题"
        :disabled="busy"
        @select="onSelect"
        @invalid="ws.invalidHint.value = $event"
      />
      <NText depth="3" class="text-xs">
        支持 PDF / PNG / JPG / WebP；识别后可在左侧微调边界再导出。
      </NText>
      <NText v-if="invalidHint !== ''" type="error" class="text-sm">{{ invalidHint }}</NText>
    </template>

    <template v-else>
      <!-- 已选文件卡 -->
      <div
        class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] px-4 py-3"
      >
        <FileText
          :size="20"
          class="shrink-0 text-[var(--lumin-color-text-secondary)]"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium" :title="name">{{ name }}</p>
          <p class="truncate text-xs text-[var(--lumin-color-text-secondary)]" :title="path">
            {{ path }}
          </p>
        </div>
        <NButton size="small" quaternary :disabled="busy" @click="resetInput">更换</NButton>
      </div>

      <!-- 导出字段区（spec §10.1） -->
      <div class="flex flex-wrap items-end gap-4">
        <label class="flex flex-col gap-1 text-xs text-[var(--lumin-color-text-secondary)]">
          起始题号
          <NInputNumber
            v-model:value="startNumberInput"
            :min="1"
            :max="9999"
            :precision="0"
            :disabled="busy"
            class="w-28"
            aria-label="起始题号"
          />
        </label>
        <label class="flex items-center gap-2 pb-1 text-sm">
          <input
            v-model="exportPdf"
            type="checkbox"
            class="h-4 w-4 accent-[var(--lumin-color-primary)]"
            :disabled="busy"
          />
          同时合成 PDF
        </label>
      </div>

      <!-- 主按钮（spec §10.3） -->
      <div class="flex flex-wrap gap-2">
        <NButton
          type="primary"
          :disabled="!canDetect"
          :loading="running === 'detect'"
          @click="run('detect')"
        >
          开始识别
        </NButton>
        <NButton :disabled="!canExport" :loading="running === 'export'" @click="run('export')">
          导出{{ regionCount > 0 ? `（${regionCount} 题）` : '' }}
        </NButton>
      </div>

      <!-- 加载态：阶段进度 + 取消（spec §10.6） -->
      <TaskProgress
        v-if="running !== null"
        :message="progress?.message ?? ''"
        :current="progress?.current"
        :total="progress?.total"
        @cancel="onCancel"
      />

      <!-- 报错态（spec §10.5/§10.6） -->
      <ErrorCard
        v-if="shownError !== null"
        :error="shownError"
        :retryable="errorIsTask && isRetryable(shownError.code)"
        @retry="retry"
      >
        <template #actions>
          <NButton
            v-if="errorIsTask && shownError?.code === 'NO_REGIONS'"
            size="small"
            @click="manualAdd"
          >
            手动添加边界
          </NButton>
          <NButton
            v-if="!errorIsTask || RESELECT_CODES.has(shownError?.code ?? '')"
            size="small"
            @click="resetInput"
          >
            重新选择
          </NButton>
        </template>
      </ErrorCard>

      <!-- 手动模式提示 -->
      <NText v-if="manualMode && ws.error.value === null" depth="3" class="text-xs">
        手动模式：点击页面插入分界线，或用 [添加题区] 补整页题区。
      </NText>

      <!-- 题目列表（题号 + 页码 + 行数，点击定位预览，spec §10.2） -->
      <div v-if="numbered.length > 0" class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <NText depth="3" class="text-xs">
            共 {{ numbered.length }} 题 · {{ totalPages > 0 ? totalPages : pages.length }} 页
          </NText>
          <NText depth="3" class="text-xs">点击定位预览</NText>
        </div>
        <ul class="flex max-h-64 flex-col gap-1 overflow-y-auto">
          <li v-for="item in numbered" :key="`${item.pageNumber}-${item.regionIndex}`">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-[var(--lumin-radius-md)] border px-2 py-1 text-left text-xs"
              :class="
                ws.pageNumber.value === item.pageNumber &&
                ws.activeRegion.value === item.regionIndex
                  ? 'border-[var(--lumin-color-primary)]'
                  : 'border-[var(--lumin-color-border)] hover:border-[var(--lumin-color-primary)]'
              "
              @click="locate(item)"
            >
              <span class="w-16 shrink-0 font-medium">第 {{ item.number }} 题</span>
              <span class="text-[var(--lumin-color-text-secondary)]">
                第 {{ item.pageNumber }} 页 · {{ item.lineCount }} 行
              </span>
            </button>
          </li>
        </ul>
      </div>

      <!-- 结果卡 -->
      <ResultCard
        v-if="outputPaths.length > 0"
        :title="`导出完成（${outputPaths.length} 个文件）`"
        :paths="outputPaths"
        reset-label="再识别一个"
        @open="openFolder"
        @reset="resetForAnother"
      />

      <!-- 识别完成但题区被清空（仍可重置/重新识别） -->
      <NText
        v-else-if="pages.length > 0 && numbered.length === 0 && ws.error.value === null"
        depth="3"
        class="text-xs"
      >
        当前没有题区：用 [添加题区] 或 [重置本页] 恢复。
      </NText>
    </template>
  </section>
</template>
