<script setup lang="ts">
/**
 * 文本对比（text-diff）：双页签——文本比较（左右文本逐行对比、词级/字符级行内粒度开关、
 * 忽略空白/大小写、并排/统一视图、差异统计与统一 diff 复制）与文件比较（M62：pick-file /
 * compare-files 两同步通道，文本模式复用 DiffResultPanel、二进制模式信息卡）。
 * 三态：空态（双输入/双路径引导）/ 加载态（同步纯函数与同步通道，豁免）/
 * 报错态（TD_TOO_LARGE、TD_CLIPBOARD_FAILED、TD_FILE_* 等，行内码 + 中文 + 重试）。
 */
import { computed, onUnmounted, ref } from 'vue'
import { ArrowLeftRight, Check, Copy, Eraser, FileDiff, FolderOpen, Sparkles } from '@lucide/vue'
import { NButton, NCheckbox, NIcon, NInput, NRadio, NRadioGroup, NTabPane, NTabs } from 'naive-ui'
import { toStructuredError, type StructuredError } from '@lumin/shared'

import DiffResultPanel from './DiffResultPanel.vue'
import { diffLines, toUnifiedDiff, type LineChange } from '../diff'
import { toolError } from '../errors'
import {
  BINARY_CHUNK_BYTES,
  compareFilesPayloadSchema,
  pickFilePayloadSchema,
  type CompareFilesResult
} from '../schema'

type ViewMode = 'side-by-side' | 'unified'
type Granularity = 'word' | 'char'
type TabKey = 'text' | 'file'

const SAMPLE_LEFT = '苹果\n香蕉\n橙子\n葡萄'
const SAMPLE_RIGHT = '苹果\n香蕉（进口）\n西瓜\n葡萄\n芒果'

const leftText = ref('')
const rightText = ref('')
const ignoreWhitespace = ref(false)
const ignoreCase = ref(false)
const viewMode = ref<ViewMode>('side-by-side')
const granularity = ref<Granularity>('word')
const copied = ref(false)
const clipboardError = ref<StructuredError | null>(null)
const activeTab = ref<TabKey>('text')

const leftPath = ref('')
const rightPath = ref('')
const fileResult = ref<CompareFilesResult | null>(null)
const fileError = ref<StructuredError | null>(null)

let copiedTimer: ReturnType<typeof setTimeout> | undefined
onUnmounted(() => {
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})

const diffResult = computed(() =>
  diffLines(leftText.value, rightText.value, {
    ignoreWhitespace: ignoreWhitespace.value,
    ignoreCase: ignoreCase.value
  })
)

const changes = computed<LineChange[]>(() =>
  diffResult.value.ok ? diffResult.value.value : []
)

const diffError = computed<StructuredError | null>(() =>
  diffResult.value.ok ? null : toolError('TD_TOO_LARGE')
)

const hasChanges = computed(() =>
  changes.value.some((item) => item.type !== 'equal')
)

const isEmpty = computed(() => leftText.value === '' && rightText.value === '')

const unifiedText = computed(() => toUnifiedDiff(changes.value))

const canCompare = computed(() => leftPath.value !== '' && rightPath.value !== '')

/** 二进制信息卡：首差异所在块号（1 起） */
const binaryChunkNo = computed(() => {
  const result = fileResult.value
  if (result === null || result.mode !== 'binary' || result.same) return 0
  const offset = result.firstDiffOffset
  if (offset === undefined) return 0
  return Math.floor(offset / BINARY_CHUNK_BYTES) + 1
})

/** 选择单文件（pick-file 同步通道；取消保持原值；路径变更清空旧结果） */
async function pickFile(side: 'left' | 'right'): Promise<void> {
  try {
    const result = await window.lumin.invoke<{ path: string | null }>(
      'text-diff:pick-file',
      pickFilePayloadSchema.parse({})
    )
    if (result.path === null) return
    if (side === 'left') leftPath.value = result.path
    else rightPath.value = result.path
    fileResult.value = null
    fileError.value = null
  } catch (err) {
    fileError.value = toStructuredError(err)
  }
}

/** 文件比较（compare-files 同步通道；失败保留已选路径并展示结构化错误） */
async function compareSelectedFiles(): Promise<void> {
  fileError.value = null
  try {
    fileResult.value = await window.lumin.invoke<CompareFilesResult>(
      'text-diff:compare-files',
      compareFilesPayloadSchema.parse({ left: leftPath.value, right: rightPath.value })
    )
  } catch (err) {
    fileError.value = toStructuredError(err)
  }
}

/** 交换左右路径并清空已比较结果 */
function swapFilePaths(): void {
  const previous = leftPath.value
  leftPath.value = rightPath.value
  rightPath.value = previous
  fileResult.value = null
  fileError.value = null
}

/** 填入示例并复位复制反馈 */
function loadSample(): void {
  leftText.value = SAMPLE_LEFT
  rightText.value = SAMPLE_RIGHT
  resetFeedback()
}

/** 交换左右文本 */
function swapSides(): void {
  const previous = leftText.value
  leftText.value = rightText.value
  rightText.value = previous
  resetFeedback()
}

/** 清空左右文本并复位反馈（为空时按钮已禁用，不会误清） */
function clearAll(): void {
  leftText.value = ''
  rightText.value = ''
  resetFeedback()
}

function resetFeedback(): void {
  copied.value = false
  clipboardError.value = null
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
}

/** 复制统一 diff 文本到剪贴板（成功 1.2s 复位文案；失败行内报错） */
async function copyUnified(): Promise<void> {
  resetFeedback()
  if (unifiedText.value === '') return
  try {
    // 主进程写剪贴板：避免 renderer 在窗口未聚焦/权限受限时 writeText 静默失败
    await window.lumin.invoke('text-diff:copy-text', { text: unifiedText.value })
    copied.value = true
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1200)
  } catch {
    clipboardError.value = toolError('TD_CLIPBOARD_FAILED')
  }
}
</script>

<template>
  <div class="flex max-w-5xl flex-col gap-4">
    <div>
      <h1 class="flex items-center gap-2 text-lg font-medium">
        <NIcon :component="FileDiff" />
        文本对比
      </h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        左右文本逐行对比，支持忽略空白、忽略大小写、并排与统一视图
      </p>
    </div>

    <NTabs v-model:value="activeTab" type="line">
      <NTabPane name="text">
        <template #tab>文本比较</template>
      </NTabPane>
      <NTabPane name="file">
        <template #tab>文件比较</template>
      </NTabPane>
    </NTabs>

    <!-- 文本比较页签 -->
    <div v-if="activeTab === 'text'" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-4">
        <NRadioGroup v-model:value="viewMode" size="small" aria-label="视图模式">
          <NRadio value="side-by-side">并排</NRadio>
          <NRadio value="unified">统一</NRadio>
        </NRadioGroup>
        <NRadioGroup
          v-model:value="granularity"
          size="small"
          aria-label="行内高亮粒度"
          data-granularity
        >
          <NRadio value="word">词级</NRadio>
          <NRadio value="char">字符级</NRadio>
        </NRadioGroup>
        <NCheckbox
          v-model:checked="ignoreWhitespace"
          @update:checked="resetFeedback"
          aria-label="忽略空白"
        >
          忽略空白
        </NCheckbox>
        <NCheckbox v-model:checked="ignoreCase" @update:checked="resetFeedback" aria-label="忽略大小写">
          忽略大小写
        </NCheckbox>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <NButton size="small" data-sample @click="loadSample">
            <template #icon><NIcon :component="Sparkles" /></template>
            示例
          </NButton>
          <NButton size="small" data-swap @click="swapSides">
            <template #icon><NIcon :component="ArrowLeftRight" /></template>
            交换
          </NButton>
          <NButton size="small" data-clear :disabled="isEmpty" @click="clearAll">
            <template #icon><NIcon :component="Eraser" /></template>
            清空
          </NButton>
          <NButton type="primary" size="small" data-copy-diff :disabled="!hasChanges" @click="copyUnified">
            <template #icon><NIcon :component="copied ? Check : Copy" /></template>
            {{ copied ? '已复制' : '复制统一 diff' }}
          </NButton>
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-1">
          <span class="text-sm text-[var(--lumin-color-text-secondary)]">左侧文本</span>
          <NInput
            v-model:value="leftText"
            type="textarea"
            :rows="12"
            placeholder="粘贴左侧文本…"
            data-left-input
            @input="resetFeedback"
          />
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-sm text-[var(--lumin-color-text-secondary)]">右侧文本</span>
          <NInput
            v-model:value="rightText"
            type="textarea"
            :rows="12"
            placeholder="粘贴右侧文本…"
            data-right-input
            @input="resetFeedback"
          />
        </div>
      </div>

      <div v-if="diffError !== null" role="alert" class="text-sm text-[var(--lumin-color-error)]">
        {{ diffError.message }}（{{ diffError.code }}）
      </div>

      <div
        v-if="clipboardError !== null"
        role="alert"
        class="text-sm text-[var(--lumin-color-error)]"
      >
        {{ clipboardError.message }}（{{ clipboardError.code }}）
      </div>

      <DiffResultPanel
        :changes="changes"
        :error="diffError"
        :view-mode="viewMode"
        :granularity="granularity"
        :empty="isEmpty"
        empty-title="粘贴或输入左右两段文本开始对比"
        empty-hint="也可以点击「示例」快速查看效果"
      />
    </div>

    <!-- 文件比较页签（M62） -->
    <div v-else class="flex flex-col gap-4">
      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-1">
          <span class="text-sm text-[var(--lumin-color-text-secondary)]">左侧文件</span>
          <div class="flex gap-2">
            <NInput
              readonly
              :value="leftPath"
              placeholder="未选择文件"
              aria-label="左侧文件"
              data-file-left
            />
            <NButton size="small" data-file-pick-left @click="pickFile('left')">
              <template #icon><NIcon :component="FolderOpen" /></template>
              选择
            </NButton>
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-sm text-[var(--lumin-color-text-secondary)]">右侧文件</span>
          <div class="flex gap-2">
            <NInput
              readonly
              :value="rightPath"
              placeholder="未选择文件"
              aria-label="右侧文件"
              data-file-right
            />
            <NButton size="small" data-file-pick-right @click="pickFile('right')">
              <template #icon><NIcon :component="FolderOpen" /></template>
              选择
            </NButton>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <NButton type="primary" data-file-compare :disabled="!canCompare" @click="compareSelectedFiles">
          比较
        </NButton>
        <NButton data-file-swap @click="swapFilePaths">
          <template #icon><NIcon :component="ArrowLeftRight" /></template>
          交换
        </NButton>
      </div>

      <div
        v-if="fileError !== null"
        role="alert"
        class="flex flex-wrap items-center gap-3 text-sm text-[var(--lumin-color-error)]"
      >
        <span>{{ fileError.message }}（{{ fileError.code }}）</span>
        <NButton size="small" data-file-retry @click="compareSelectedFiles">重试</NButton>
      </div>

      <!-- 二进制模式信息卡 -->
      <div
        v-if="fileError === null && fileResult !== null && fileResult.mode === 'binary'"
        data-binary-card
        class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] px-4 py-3 text-sm text-[var(--lumin-color-text-secondary)]"
      >
        <template v-if="fileResult.same">两文件完全相同</template>
        <template v-else>
          二进制不同，首个差异位于偏移
          {{ fileResult.firstDiffOffset }}（块 {{ binaryChunkNo }}/{{ fileResult.totalChunks }}）
        </template>
      </div>

      <!-- 文本模式结果（复用统计/并排/统一面板） -->
      <DiffResultPanel
        v-if="fileError === null && fileResult !== null && fileResult.mode === 'text'"
        :changes="fileResult.changes"
        :error="null"
        :view-mode="viewMode"
        :granularity="granularity"
        :empty="false"
        empty-title="选择两个文件开始比较"
        :left-label="fileResult.leftLabel"
        :right-label="fileResult.rightLabel"
      />

      <!-- 文件比较空态 -->
      <div
        v-if="fileError === null && fileResult === null"
        data-empty-state
        class="flex flex-col items-center gap-2 rounded-[var(--lumin-radius-md)] border border-dashed border-[var(--lumin-color-border)] px-6 py-10 text-center text-sm text-[var(--lumin-color-text-secondary)]"
      >
        <NIcon :component="FileDiff" :size="28" />
        <p>选择两个文件开始比较</p>
        <p class="text-xs">点击「选择」分别指定左右两个文件</p>
      </div>
    </div>
  </div>
</template>
