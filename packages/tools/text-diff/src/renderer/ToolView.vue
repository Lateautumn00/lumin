<script setup lang="ts">
/**
 * 文本对比（text-diff）：左右文本逐行对比，支持忽略空白/大小写、并排/统一视图、
 * 差异统计与统一 diff 复制。
 * 三态：空态（双输入框 + 引导文案）/ 加载态（全同步纯函数，豁免）/
 * 报错态（超限 TD_TOO_LARGE、复制失败 TD_CLIPBOARD_FAILED，行内码 + 中文文案）。
 */
import { computed, onUnmounted, ref } from 'vue'
import { ArrowLeftRight, Check, Copy, Eraser, FileDiff, Sparkles } from '@lucide/vue'
import { NButton, NCheckbox, NIcon, NInput, NRadio, NRadioGroup } from 'naive-ui'
import type { StructuredError } from '@lumin/shared'

import {
  diffChars,
  diffLines,
  diffStats,
  prefixOf,
  sideSegments,
  toUnifiedDiff,
  type InlineSegment,
  type LineChange,
  type LineChangeType
} from '../diff'
import { toolError } from '../errors'

type ViewMode = 'side-by-side' | 'unified'
type CellChange = LineChangeType | 'empty'

interface SideRow {
  leftNo: number | null
  rightNo: number | null
  leftChange: CellChange
  rightChange: CellChange
  leftSegments: InlineSegment[]
  rightSegments: InlineSegment[]
}

const SAMPLE_LEFT = '苹果\n香蕉\n橙子\n葡萄'
const SAMPLE_RIGHT = '苹果\n香蕉（进口）\n西瓜\n葡萄\n芒果'

const leftText = ref('')
const rightText = ref('')
const ignoreWhitespace = ref(false)
const ignoreCase = ref(false)
const viewMode = ref<ViewMode>('side-by-side')
const copied = ref(false)
const clipboardError = ref<StructuredError | null>(null)

let copiedTimer: ReturnType<typeof setTimeout> | undefined

const diffResult = computed(() =>
  diffLines(leftText.value, rightText.value, {
    ignoreWhitespace: ignoreWhitespace.value,
    ignoreCase: ignoreCase.value
  })
)

const changes = computed<LineChange[]>(() => (diffResult.value.ok ? diffResult.value.value : []))

const diffError = computed<StructuredError | null>(() => {
  const result = diffResult.value
  return result.ok ? null : toolError('TD_TOO_LARGE', result.message)
})

const stats = computed(() => diffStats(changes.value))
const hasChanges = computed(() => stats.value.added + stats.value.removed > 0)
const isEmpty = computed(() => leftText.value === '' && rightText.value === '')
const unifiedText = computed(() => (diffError.value !== null ? '' : toUnifiedDiff(changes.value)))

/** 并排视图行：连续删除/新增块按序配对，配对行做字符级差异 */
const sideRows = computed<SideRow[]>(() => {
  const list = changes.value
  const rows: SideRow[] = []
  let index = 0

  while (index < list.length) {
    const item = list[index]
    if (item === undefined) break

    if (item.type === 'equal') {
      rows.push({
        leftNo: item.leftLine,
        rightNo: item.rightLine,
        leftChange: 'equal',
        rightChange: 'equal',
        leftSegments: [{ type: 'equal', text: item.text }],
        rightSegments: [{ type: 'equal', text: item.text }]
      })
      index += 1
      continue
    }

    const deletes: LineChange[] = []
    const inserts: LineChange[] = []
    while (index < list.length) {
      const next = list[index]
      if (next === undefined || next.type === 'equal') break
      if (next.type === 'delete') deletes.push(next)
      else inserts.push(next)
      index += 1
    }

    const rowCount = Math.max(deletes.length, inserts.length)
    for (let offset = 0; offset < rowCount; offset += 1) {
      const deleted = deletes[offset]
      const inserted = inserts[offset]
      if (deleted !== undefined && inserted !== undefined) {
        const segments = diffChars(deleted.text, inserted.text)
        rows.push({
          leftNo: deleted.leftLine,
          rightNo: inserted.rightLine,
          leftChange: 'delete',
          rightChange: 'insert',
          leftSegments: sideSegments(segments, 'left'),
          rightSegments: sideSegments(segments, 'right')
        })
      } else if (deleted !== undefined) {
        rows.push({
          leftNo: deleted.leftLine,
          rightNo: null,
          leftChange: 'delete',
          rightChange: 'empty',
          leftSegments: [{ type: 'delete', text: deleted.text }],
          rightSegments: []
        })
      } else if (inserted !== undefined) {
        rows.push({
          leftNo: null,
          rightNo: inserted.rightLine,
          leftChange: 'empty',
          rightChange: 'insert',
          leftSegments: [],
          rightSegments: [{ type: 'insert', text: inserted.text }]
        })
      }
    }
  }

  return rows
})

function cellStyle(change: CellChange): Record<string, string> {
  if (change === 'delete') {
    return { backgroundColor: 'color-mix(in srgb, var(--lumin-color-error) 8%, transparent)' }
  }
  if (change === 'insert') {
    return { backgroundColor: 'color-mix(in srgb, var(--lumin-color-success) 8%, transparent)' }
  }
  return {}
}

function segmentClass(type: LineChangeType): string {
  if (type === 'delete') return 'text-[var(--lumin-color-error)]'
  if (type === 'insert') return 'text-[var(--lumin-color-success)]'
  return ''
}

function loadSample(): void {
  leftText.value = SAMPLE_LEFT
  rightText.value = SAMPLE_RIGHT
  resetFeedback()
}

function swapSides(): void {
  const previous = leftText.value
  leftText.value = rightText.value
  rightText.value = previous
  resetFeedback()
}

function clearAll(): void {
  leftText.value = ''
  rightText.value = ''
  resetFeedback()
}

function resetFeedback(): void {
  copied.value = false
  clipboardError.value = null
  if (copiedTimer !== undefined) {
    clearTimeout(copiedTimer)
    copiedTimer = undefined
  }
}

async function copyUnified(): Promise<void> {
  if (unifiedText.value === '') return
  clipboardError.value = null
  try {
    await navigator.clipboard.writeText(unifiedText.value)
    copied.value = true
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1200)
  } catch {
    clipboardError.value = toolError('TD_CLIPBOARD_FAILED')
  }
}

onUnmounted(() => {
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="flex max-w-5xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">文本对比</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        左右文本逐行对比，支持忽略空白/大小写、并排与统一视图、差异统计与统一 diff
        复制（本地计算、不联网）
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-4">
      <NRadioGroup v-model:value="viewMode" size="small" aria-label="视图模式">
        <NRadio value="side-by-side">并排</NRadio>
        <NRadio value="unified">统一</NRadio>
      </NRadioGroup>
      <NCheckbox v-model:checked="ignoreWhitespace">忽略空白</NCheckbox>
      <NCheckbox v-model:checked="ignoreCase">忽略大小写</NCheckbox>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <NButton size="small" data-sample @click="loadSample">
          <template #icon><NIcon :component="Sparkles" /></template>
          示例
        </NButton>
        <NButton size="small" data-swap @click="swapSides">
          <template #icon><NIcon :component="ArrowLeftRight" /></template>
          交换
        </NButton>
        <NButton size="small" :disabled="isEmpty" data-clear @click="clearAll">
          <template #icon><NIcon :component="Eraser" /></template>
          清空
        </NButton>
        <NButton
          size="small"
          type="primary"
          :disabled="!hasChanges"
          data-copy-diff
          @click="copyUnified"
        >
          <template #icon><NIcon :component="copied ? Check : Copy" /></template>
          {{ copied ? '已复制' : '复制统一 diff' }}
        </NButton>
      </div>
    </div>

    <div class="grid gap-3 md:grid-cols-2">
      <label class="flex flex-col gap-1">
        <span class="text-sm text-[var(--lumin-color-text-secondary)]">左侧文本</span>
        <NInput
          v-model:value="leftText"
          type="textarea"
          :rows="12"
          placeholder="粘贴左侧文本…"
          aria-label="左侧文本"
          data-left-input
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-sm text-[var(--lumin-color-text-secondary)]">右侧文本</span>
        <NInput
          v-model:value="rightText"
          type="textarea"
          :rows="12"
          placeholder="粘贴右侧文本…"
          aria-label="右侧文本"
          data-right-input
        />
      </label>
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

    <div
      v-if="diffError === null"
      data-stats
      class="flex flex-wrap items-center gap-4 text-sm text-[var(--lumin-color-text-secondary)]"
    >
      <span
        >新增
        <b data-stat-added class="text-[var(--lumin-color-success)]">+{{ stats.added }}</b></span
      >
      <span
        >删除
        <b data-stat-removed class="text-[var(--lumin-color-error)]">-{{ stats.removed }}</b></span
      >
      <span
        >相同
        <b data-stat-unchanged class="text-[var(--lumin-color-text)]">{{
          stats.unchanged
        }}</b></span
      >
    </div>

    <div
      v-if="diffError === null && isEmpty"
      data-empty-state
      class="flex flex-col items-center gap-2 rounded-[var(--lumin-radius-md)] border border-dashed border-[var(--lumin-color-border)] px-6 py-10 text-center text-sm text-[var(--lumin-color-text-secondary)]"
    >
      <NIcon :component="FileDiff" :size="28" />
      <p>粘贴或输入左右两段文本开始对比</p>
      <p class="text-xs">也可以点击「示例」快速查看效果</p>
    </div>

    <div
      v-if="diffError === null && !isEmpty && viewMode === 'side-by-side'"
      data-diff-side-by-side
      class="overflow-x-auto rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)]"
    >
      <div
        class="grid grid-cols-2 border-b border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] text-xs font-medium text-[var(--lumin-color-text-secondary)]"
      >
        <div class="border-r border-[var(--lumin-color-border)] px-3 py-2">左侧</div>
        <div class="px-3 py-2">右侧</div>
      </div>
      <div
        v-for="(row, index) in sideRows"
        :key="index"
        data-diff-row
        class="grid grid-cols-2 border-b border-[var(--lumin-color-border)] last:border-b-0"
      >
        <div
          class="flex gap-2 border-r border-[var(--lumin-color-border)] px-2 py-1"
          data-diff-cell="left"
          :data-change="row.leftChange"
          :style="cellStyle(row.leftChange)"
        >
          <span
            class="w-10 shrink-0 select-none text-right text-xs text-[var(--lumin-color-text-secondary)]"
          >
            {{ row.leftNo ?? '' }}
          </span>
          <span class="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-sm">
            <span
              v-for="(segment, segmentIndex) in row.leftSegments"
              :key="segmentIndex"
              :class="segmentClass(segment.type)"
              >{{ segment.text }}</span
            >
          </span>
        </div>
        <div
          class="flex gap-2 px-2 py-1"
          data-diff-cell="right"
          :data-change="row.rightChange"
          :style="cellStyle(row.rightChange)"
        >
          <span
            class="w-10 shrink-0 select-none text-right text-xs text-[var(--lumin-color-text-secondary)]"
          >
            {{ row.rightNo ?? '' }}
          </span>
          <span class="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-sm">
            <span
              v-for="(segment, segmentIndex) in row.rightSegments"
              :key="segmentIndex"
              :class="segmentClass(segment.type)"
              >{{ segment.text }}</span
            >
          </span>
        </div>
      </div>
    </div>

    <div
      v-if="diffError === null && !isEmpty && viewMode === 'unified'"
      data-unified-diff
      class="overflow-x-auto rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)]"
    >
      <div
        v-for="(item, index) in changes"
        :key="index"
        data-unified-row
        :data-change="item.type"
        class="flex items-start gap-2 border-b border-[var(--lumin-color-border)] px-2 py-1 last:border-b-0"
        :style="cellStyle(item.type)"
      >
        <span
          class="w-10 shrink-0 select-none text-right text-xs text-[var(--lumin-color-text-secondary)]"
        >
          {{ item.leftLine ?? '' }}
        </span>
        <span
          class="w-10 shrink-0 select-none text-right text-xs text-[var(--lumin-color-text-secondary)]"
        >
          {{ item.rightLine ?? '' }}
        </span>
        <span class="w-3 shrink-0 font-mono text-sm" :class="segmentClass(item.type)">
          {{ prefixOf(item.type) }}
        </span>
        <span class="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-sm">
          {{ item.text }}
        </span>
      </div>
    </div>
  </div>
</template>
