<script setup lang="ts">
/**
 * 对比结果面板（text-diff）：统计、空态、并排/统一渲染，文本比较与文件比较文本模式共用
 * （M62 抽取自 ToolView，渲染结构与 data 属性保持不变，既有 e2e 断言零改动）。
 * 并排配对行按粒度开关做词级（diffWords，默认）或字符级（diffChars）行内高亮。
 */
import { computed } from 'vue'
import { FileDiff } from '@lucide/vue'
import { NIcon } from 'naive-ui'
import type { StructuredError } from '@lumin/shared'

import {
  diffChars,
  diffStats,
  diffWords,
  prefixOf,
  sideSegments,
  type InlineSegment,
  type LineChange,
  type LineChangeType
} from '../diff'

type CellChange = LineChangeType | 'empty'
type Granularity = 'word' | 'char'
type ViewMode = 'side-by-side' | 'unified'

interface SideRow {
  leftNo: number | null
  rightNo: number | null
  leftChange: CellChange
  rightChange: CellChange
  leftSegments: InlineSegment[]
  rightSegments: InlineSegment[]
}

const props = withDefaults(
  defineProps<{
    /** 行级对比结果 */
    changes: readonly LineChange[]
    /** 结构化错误：非空时隐藏统计与结果区（报错态） */
    error: StructuredError | null
    /** 视图模式（并排 / 统一） */
    viewMode: ViewMode
    /** 行内高亮粒度（词级 / 字符级） */
    granularity: Granularity
    /** 空态判定 */
    empty: boolean
    /** 空态引导主文案 */
    emptyTitle: string
    /** 空态引导副文案（缺省不展示） */
    emptyHint?: string
    /** 并排左列表头 */
    leftLabel?: string
    /** 并排右列表头 */
    rightLabel?: string
  }>(),
  {
    emptyHint: '',
    leftLabel: '左侧',
    rightLabel: '右侧'
  }
)

const stats = computed(() => diffStats(props.changes))

/** 并排视图行：连续删除/新增块按序配对，配对行按粒度开关做词级/字符级差异 */
const sideRows = computed<SideRow[]>(() => {
  const list = props.changes
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
        const segments =
          props.granularity === 'word'
            ? diffWords(deleted.text, inserted.text)
            : diffChars(deleted.text, inserted.text)
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
</script>

<template>
  <div
    v-if="error === null"
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
    v-if="error === null && empty"
    data-empty-state
    class="flex flex-col items-center gap-2 rounded-[var(--lumin-radius-md)] border border-dashed border-[var(--lumin-color-border)] px-6 py-10 text-center text-sm text-[var(--lumin-color-text-secondary)]"
  >
    <NIcon :component="FileDiff" :size="28" />
    <p>{{ emptyTitle }}</p>
    <p v-if="emptyHint !== ''" class="text-xs">{{ emptyHint }}</p>
  </div>

  <div
    v-if="error === null && !empty && viewMode === 'side-by-side'"
    data-diff-side-by-side
    class="overflow-x-auto rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)]"
  >
    <div
      class="grid grid-cols-2 border-b border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] text-xs font-medium text-[var(--lumin-color-text-secondary)]"
    >
      <div class="border-r border-[var(--lumin-color-border)] px-3 py-2">{{ leftLabel }}</div>
      <div class="px-3 py-2">{{ rightLabel }}</div>
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
            :data-segment="segment.type"
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
            :data-segment="segment.type"
            :class="segmentClass(segment.type)"
            >{{ segment.text }}</span
          >
        </span>
      </div>
    </div>
  </div>

  <div
    v-if="error === null && !empty && viewMode === 'unified'"
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
</template>
