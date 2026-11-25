<script setup lang="ts">
import { computed, onUnmounted, provide, ref, watch } from 'vue'
import { NButton, NInput, NInputNumber, NRadioButton, NRadioGroup, NText } from 'naive-ui'
import { FileText } from '@lucide/vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import PathLink from '@lumin/ui/PathLink.vue'
import { isRetryable } from '../errors'
import type { CropPayload, SplitPayload } from '../schema'
import {
  FULL_PAGE_BOX,
  mmToRatio,
  parseRangeText,
  ratioToMm,
  type CropBox,
  type PageSize,
  type PdfRange
} from '../preview'
import PdfPreview from './PdfPreview.vue'
import OcrPreview from './OcrPreview.vue'
import OcrPanel from './OcrPanel.vue'
import ErrorCard from './ErrorCard.vue'
import ResultCard from './ResultCard.vue'
import { createOcrWorkspace, OCR_WORKSPACE } from './ocr-workspace'
import { cancelTask, revealPath, submitCrop, submitSplit, type SubmitResult } from './client'

type Op = 'split' | 'crop'
type Phase = 'idle' | 'running' | 'error'

const OPS: readonly { id: Op; label: string }[] = [
  { id: 'split', label: '拆分' },
  { id: 'crop', label: '裁剪' }
]

/** 单文件操作的预览/重新选择入口（spec §5 操作入口列） */
const RESELECT_CODES = new Set(['PDF_NOT_FOUND', 'PDF_ENCRYPTED'])
/** 需回填区间输入框的操作入口（spec §5） */
const REREINPUT_CODES = new Set(['RANGE_INVALID'])

const tab = ref<'pdf' | 'ocr'>('pdf')
const op = ref<Op>('split')
const phase = ref<Phase>('idle')

// OCR Tab 会话（左右两栏共享；首次激活后挂载并 v-show 保留状态）
const ocr = createOcrWorkspace()
provide(OCR_WORKSPACE, ocr)
const { inputFile: ocrInputFile } = ocr
const ocrMounted = ref(false)
watch(
  tab,
  (value) => {
    if (value === 'ocr') ocrMounted.value = true
  },
  { immediate: true }
)

// 单文件输入（拆分/裁剪共用）
const inputFile = ref<File | null>(null)
const inputPath = ref('')
const inputName = ref('')
const invalidHint = ref('')

// 页码区间（spec §2 点选 ↔ 文本框双向同步）
const rangesText = ref('')
const rangesInvalid = ref(false)
const rangesHint = ref('')
const previewRange = ref<PdfRange[]>([])
const pageCount = ref(0)
const pageSize = ref<PageSize | null>(null)
const rangesInput = ref<InstanceType<typeof NInput> | null>(null)

// 裁剪框（比例为源，mm 输入回显；spec §1/§2）
const cropRatio = ref<CropBox | null>(null)
const mmX = ref(0)
const mmY = ref(0)
const mmW = ref(0)
const mmH = ref(0)

// 产物命名模板（选填，留空 = 默认命名；spec §7.2）
const nameTemplate = ref('')
const TEMPLATE_TOKENS = ['name', 'op', 'label', 'date']
const templateError = computed(() => {
  const text = nameTemplate.value.trim()
  if (text === '') return ''
  if (text.length > 120) return '命名模板最多 120 个字符'
  if (/[\\/:*?"<>|]/.test(text)) return '命名模板不能包含 \\ / : * ? " < > |'
  if (!text.includes('{name}')) return '命名模板必须包含 {name}'
  const invalid = [...text.matchAll(/\{([^{}]*)\}/g)].find(
    (match) => !TEMPLATE_TOKENS.includes(match[1] ?? '')
  )
  if (invalid !== undefined) return `命名模板包含不支持的占位符 ${invalid[0]}`
  return ''
})

// 任务态（spec §6 三态）
const progress = ref<{ current?: number; total?: number; message: string } | null>(null)
const error = ref<StructuredError | null>(null)
const outputPaths = ref<string[]>([])

let unsubscribe: (() => void) | null = null
let currentTaskId = ''

const busy = computed(() => phase.value === 'running')
const retryable = computed(() => error.value !== null && isRetryable(error.value.code))
const canSubmit = computed(() => {
  if (busy.value || templateError.value !== '') return false
  switch (op.value) {
    case 'split':
      return inputPath.value !== '' && rangesText.value.trim() !== ''
    default:
      return inputPath.value !== ''
  }
})

function detach(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  currentTaskId = ''
}

function setError(err: unknown): void {
  error.value = toStructuredError(err)
  phase.value = 'error'
  progress.value = null
  detach()
}

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
  if (event.kind === 'done') {
    phase.value = 'idle'
    progress.value = null
    const result = event.result as { outputPaths?: string[] } | undefined
    outputPaths.value = result?.outputPaths ?? []
    return
  }
  if (event.error.code === 'CANCELLED') {
    phase.value = 'idle'
    progress.value = null
    return
  }
  error.value = event.error
  phase.value = 'error'
  progress.value = null
}

/** 非空时附加命名模板（spec §7.2） */
/** 非空模板的载荷片段（spec §7.2） */
function templateFields(): { nameTemplate?: string } {
  const template = nameTemplate.value.trim()
  return template === '' ? {} : { nameTemplate: template }
}

function submit(): Promise<SubmitResult> {
  switch (op.value) {
    case 'split': {
      const payload: SplitPayload = {
        inputPath: inputPath.value,
        ranges: rangesText.value,
        ...templateFields()
      }
      return submitSplit(payload)
    }
    case 'crop': {
      const payload: CropPayload = {
        inputPath: inputPath.value,
        box: cropRatio.value ?? FULL_PAGE_BOX,
        ...templateFields()
      }
      const text = rangesText.value.trim()
      if (text !== '') payload.ranges = text
      return submitCrop(payload)
    }
  }
}

/** 前端区间初校（spec §3.1）：语法 + 越界，通过才提交 */
function validateRanges(): boolean {
  const text = rangesText.value.trim()
  if (op.value === 'split' && text === '') {
    rangesHint.value = '请填写页码区间'
    return false
  }
  if (text === '') return true
  const parsed = parseRangeText(text)
  if (parsed === null) {
    rangesInvalid.value = true
    return false
  }
  if (pageCount.value > 0 && parsed.some((range) => range.end > pageCount.value)) {
    rangesInvalid.value = true
    rangesHint.value = `页码超出范围（共 ${pageCount.value} 页）`
    return false
  }
  rangesInvalid.value = false
  rangesHint.value = ''
  previewRange.value = parsed
  return true
}

async function start(): Promise<void> {
  if (!canSubmit.value || !validateRanges()) return
  error.value = null
  outputPaths.value = []
  phase.value = 'running'
  progress.value = { message: '提交中…' }
  try {
    const { taskId } = await submit()
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

function retry(): void {
  void start()
}

function focusRanges(): void {
  rangesInput.value?.focus()
}

/** 再处理一个：清结果卡与字段，预览与 Tab 保留（spec §3.1） */
function resetForResult(): void {
  outputPaths.value = []
  error.value = null
  progress.value = null
  phase.value = 'idle'
  rangesText.value = ''
  rangesInvalid.value = false
  rangesHint.value = ''
  previewRange.value = []
  cropRatio.value = op.value === 'crop' ? { ...FULL_PAGE_BOX } : null
}

/** 重新选择输入（spec §5 操作入口）：清输入与预览 */
function resetInput(): void {
  detach()
  inputFile.value = null
  inputPath.value = ''
  inputName.value = ''
  invalidHint.value = ''
  rangesText.value = ''
  rangesInvalid.value = false
  rangesHint.value = ''
  previewRange.value = []
  pageCount.value = 0
  pageSize.value = null
  outputPaths.value = []
  error.value = null
  progress.value = null
  phase.value = 'idle'
}

function onSelect(payload: { file: File; path: string }): void {
  inputFile.value = payload.file
  inputPath.value = payload.path
  inputName.value = payload.file.name
  invalidHint.value = ''
  error.value = null
  if (phase.value === 'error') phase.value = 'idle'
}

function onInvalid(reason: string): void {
  invalidHint.value = reason
}

/** 点选生成的规范化区间文本回写输入框（spec §2） */
function onRangeText(text: string): void {
  rangesText.value = text
  rangesInvalid.value = false
  rangesHint.value = ''
}

/** 文本框失焦 → 重新解析回写高亮；失败保留原文标红（spec §2） */
function onRangesBlur(): void {
  const text = rangesText.value.trim()
  if (text === '') {
    rangesInvalid.value = false
    rangesHint.value = ''
    previewRange.value = []
    return
  }
  const parsed = parseRangeText(text)
  if (parsed === null) {
    rangesInvalid.value = true
    return
  }
  rangesInvalid.value = false
  rangesHint.value = ''
  previewRange.value = parsed
}

function onDocMeta(meta: { pageCount: number; pageSize: PageSize }): void {
  pageCount.value = meta.pageCount
  pageSize.value = meta.pageSize
}

function onPreviewError(err: StructuredError): void {
  error.value = err
  phase.value = 'error'
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

/** mm 输入回显比例框变化（拖拽 → 4 输入框，spec §2 实时回显） */
function syncMmFromRatio(): void {
  const box = cropRatio.value
  const page = pageSize.value
  if (box === null || page === null) return
  const mm = ratioToMm(box, page)
  const apply = (target: { value: number }, value: number): void => {
    const rounded = Math.round(value * 10) / 10
    if (Math.abs(target.value - rounded) > 0.05) target.value = rounded
  }
  apply(mmX, mm.x)
  apply(mmY, mm.y)
  apply(mmW, mm.width)
  apply(mmH, mm.height)
}

/** mm 输入 → 比例框（键盘微调，spec §2） */
function syncRatioFromMm(): void {
  const page = pageSize.value
  if (page === null || op.value !== 'crop') return
  const next = mmToRatio({ x: mmX.value, y: mmY.value, width: mmW.value, height: mmH.value }, page)
  if (next === null) return
  const current = cropRatio.value
  const same =
    current !== null &&
    Math.abs(current.x - next.x) < 1e-3 &&
    Math.abs(current.y - next.y) < 1e-3 &&
    Math.abs(current.width - next.width) < 1e-3 &&
    Math.abs(current.height - next.height) < 1e-3
  if (!same) cropRatio.value = next
}

function resetCrop(): void {
  cropRatio.value = { ...FULL_PAGE_BOX }
  syncMmFromRatio()
}

watch(op, (next) => {
  rangesHint.value = ''
  rangesInvalid.value = false
  if (next === 'crop') {
    if (cropRatio.value === null) cropRatio.value = { ...FULL_PAGE_BOX }
  } else {
    cropRatio.value = null
  }
})

watch([cropRatio, pageSize], syncMmFromRatio)
watch([mmX, mmY, mmW, mmH], syncRatioFromMm)

onUnmounted(detach)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <!-- Tab 栏（spec §2/§10.2：双 Tab 均激活，互不挤占） -->
    <div
      class="flex shrink-0 gap-2 border-b border-[var(--lumin-color-border)] pb-3"
      role="tablist"
    >
      <NButton
        size="small"
        :type="tab === 'pdf' ? 'primary' : 'default'"
        role="tab"
        :aria-selected="tab === 'pdf'"
        @click="tab = 'pdf'"
      >
        PDF 操作
      </NButton>
      <NButton
        size="small"
        :type="tab === 'ocr' ? 'primary' : 'default'"
        role="tab"
        :aria-selected="tab === 'ocr'"
        @click="tab = 'ocr'"
      >
        OCR 切题
      </NButton>
    </div>

    <div class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <!-- 左：预览（spec §2） -->
      <section class="flex min-h-0 flex-col overflow-hidden">
        <div v-show="tab === 'pdf'" class="flex min-h-0 flex-1 flex-col">
          <PdfPreview
            v-model:range="previewRange"
            v-model:crop="cropRatio"
            :file="inputFile"
            :disabled="busy"
            @range-text="onRangeText"
            @doc-meta="onDocMeta"
            @error="onPreviewError"
          />
        </div>

        <!-- OCR 左侧预览（首次激活后挂载，v-show 保留状态） -->
        <div v-show="tab === 'ocr'" class="flex min-h-0 flex-1 flex-col">
          <OcrPreview v-if="ocrMounted" :file="ocrInputFile" />
        </div>
      </section>

      <!-- 右：PDF 操作 / OCR 面板（spec §2/§10.2） -->
      <section
        v-show="tab === 'pdf'"
        class="flex min-h-0 flex-col gap-3 overflow-y-auto"
        aria-label="PDF 操作"
      >
        <DropZone
          v-if="inputPath === ''"
          accept=".pdf"
          hint="拖拽 PDF 到此处，或点击选择"
          :disabled="busy"
          @select="onSelect"
          @invalid="onInvalid"
        />
        <NText v-if="invalidHint !== ''" type="error" class="text-sm">{{ invalidHint }}</NText>

        <!-- 已选文件卡 -->
        <div
          v-if="inputPath !== ''"
          class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] px-4 py-3"
        >
          <FileText
            :size="20"
            class="shrink-0 text-[var(--lumin-color-text-secondary)]"
            aria-hidden="true"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium" :title="inputName">{{ inputName }}</p>
            <div class="min-w-0">
              <PathLink :path="inputPath" :reveal="false" />
            </div>
          </div>
          <NButton size="small" quaternary :disabled="busy" @click="resetInput">更换</NButton>
        </div>

        <!-- 操作选择器（spec §2 两项：拆分/裁剪） -->
        <NRadioGroup
          v-model:value="op"
          size="small"
          class="flex flex-wrap gap-1"
          aria-label="操作类型"
        >
          <NRadioButton v-for="item in OPS" :key="item.id" :value="item.id" :label="item.label" />
        </NRadioGroup>

        <NText depth="3" class="text-xs"> 合并、删页、旋转、重排等请使用「PDF 工具集」。 </NText>

        <!-- 字段区（spec §3.2 两操作字段矩阵）：label 包裹输入建立 a11y 关联（NInput 无 id prop） -->
        <label class="flex flex-col gap-2">
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">
            页码区间{{ op === 'split' ? '（必填）' : '（选填，留空 = 全部页）' }}
          </span>
          <NInput
            ref="rangesInput"
            v-model:value="rangesText"
            :status="rangesInvalid ? 'error' : undefined"
            placeholder="如 1-3,5,7-9"
            :disabled="busy"
            clearable
            @blur="onRangesBlur"
            @update:value="rangesInvalid = false"
          />
          <NText v-if="rangesHint !== ''" type="error" class="text-xs">{{ rangesHint }}</NText>
          <NText v-else-if="rangesInvalid" type="error" class="text-xs">
            区间语法无效，已保留原文
          </NText>
        </label>

        <div v-if="op === 'crop'" class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">
              裁剪框（mm，当前预览页参照）
            </span>
            <NButton size="tiny" quaternary :disabled="busy" @click="resetCrop">重置整页</NButton>
          </div>
          <div class="grid grid-cols-4 gap-2">
            <label class="flex flex-col gap-1 text-xs text-[var(--lumin-color-text-secondary)]">
              X
              <NInputNumber
                v-model:value="mmX"
                :min="0"
                :precision="1"
                :disabled="busy || pageSize === null"
                aria-label="裁剪框 X"
              />
            </label>
            <label class="flex flex-col gap-1 text-xs text-[var(--lumin-color-text-secondary)]">
              Y
              <NInputNumber
                v-model:value="mmY"
                :min="0"
                :precision="1"
                :disabled="busy || pageSize === null"
                aria-label="裁剪框 Y"
              />
            </label>
            <label class="flex flex-col gap-1 text-xs text-[var(--lumin-color-text-secondary)]">
              宽
              <NInputNumber
                v-model:value="mmW"
                :min="0.1"
                :precision="1"
                :disabled="busy || pageSize === null"
                aria-label="裁剪框宽度"
              />
            </label>
            <label class="flex flex-col gap-1 text-xs text-[var(--lumin-color-text-secondary)]">
              高
              <NInputNumber
                v-model:value="mmH"
                :min="0.1"
                :precision="1"
                :disabled="busy || pageSize === null"
                aria-label="裁剪框高度"
              />
            </label>
          </div>
          <NText depth="3" class="text-xs">在左侧当前页上拖拽绘制裁剪框，数值实时回显</NText>
        </div>

        <!-- 产物命名模板（选填，spec §7.2；空 = 默认命名） -->
        <label class="flex flex-col gap-2">
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">
            产物命名模板（选填，留空 = 默认命名）
          </span>
          <NInput
            v-model:value="nameTemplate"
            :status="templateError !== '' ? 'error' : undefined"
            placeholder="如 {name}-{label}"
            :disabled="busy"
            clearable
          />
          <NText v-if="templateError !== ''" type="error" class="text-xs">
            {{ templateError }}
          </NText>
          <NText v-else depth="3" class="text-xs">
            占位符：{name} 原名 · {op} 操作 · {label} 标签 · {date} 日期（自动补 .pdf）
          </NText>
        </label>

        <!-- 主按钮 -->
        <NButton type="primary" :disabled="!canSubmit" :loading="busy" @click="start">
          开始处理
        </NButton>

        <!-- 加载态：任务进度（可取消，spec §6） -->
        <TaskProgress
          v-if="phase === 'running'"
          :message="progress?.message ?? ''"
          :current="progress?.current"
          :total="progress?.total"
          @cancel="onCancel"
        />

        <!-- 成功结果卡 -->
        <ResultCard
          v-if="outputPaths.length > 0"
          :title="`处理完成（${outputPaths.length} 个文件）`"
          :paths="outputPaths"
          reset-label="再处理一个"
          @open="openFolder"
          @reset="resetForResult"
        />

        <!-- 报错态（spec §5/§6：结构化码 → 中文文案 + 操作入口） -->
        <ErrorCard
          v-if="phase === 'error' && error !== null"
          :error="error"
          :retryable="retryable"
          @retry="retry"
        >
          <template #actions>
            <NButton v-if="RESELECT_CODES.has(error.code)" size="small" @click="resetInput">
              重新选择
            </NButton>
            <NButton v-if="REREINPUT_CODES.has(error.code)" size="small" @click="focusRanges">
              重新输入
            </NButton>
          </template>
        </ErrorCard>
      </section>

      <!-- OCR 右栏面板（首次激活后挂载，v-show 保留状态） -->
      <OcrPanel v-if="ocrMounted" v-show="tab === 'ocr'" />
    </div>
  </div>
</template>
