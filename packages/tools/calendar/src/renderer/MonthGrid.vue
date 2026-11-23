<script setup lang="ts">
/**
 * @file 自绘月格（恒 42 格，周一起始；不用 NCalendar 以避免 :deep() 改库样式）
 * @author cuilanchao
 * @date 2026-11-23
 */
import type { MonthCell } from '../lunar'

defineProps<{
  cells: MonthCell[]
  /** 选中日（本地零点比较） */
  selected: Date
  /** 今天 YYYY-MM-DD */
  todayYmd: string
  /** 与 cells 等长：该格是否有纪念日 */
  flags: boolean[]
}>()

const emit = defineEmits<{ select: [date: Date] }>()

const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'] as const

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** 格内次行：节气（主色）> 节日（危险色）> 农历（次要） */
function subLine(cell: MonthCell): { text: string; tone: string } {
  if (cell.info.jieqi) {
    return { text: cell.info.jieqi, tone: 'text-[var(--lumin-color-primary)]' }
  }
  const festival = cell.info.festivals[0]
  if (festival) return { text: festival, tone: 'text-[var(--lumin-color-danger)]' }
  return { text: cell.info.lunarText, tone: 'text-[var(--lumin-color-text-secondary)]' }
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="grid grid-cols-7 gap-1">
      <div
        v-for="w in WEEK_HEAD"
        :key="w"
        class="pb-1 text-center text-xs text-[var(--lumin-color-text-secondary)]"
      >
        {{ w }}
      </div>
    </div>
    <div class="grid grid-cols-7 gap-1" role="grid" aria-label="月历">
      <button
        v-for="(cell, index) in cells"
        :key="`${cell.info.solar}-${index}`"
        type="button"
        role="gridcell"
        :aria-label="cell.info.solar"
        :aria-selected="isSameDay(cell.date, selected)"
        class="flex min-h-14 flex-col items-center gap-0.5 rounded-[var(--lumin-radius-sm)] border px-1 pt-1 pb-0.5 transition-colors"
        :class="[
          isSameDay(cell.date, selected)
            ? 'border-[var(--lumin-color-primary)] bg-[var(--lumin-color-primary-soft)]'
            : 'border-[var(--lumin-color-border)] hover:border-[var(--lumin-color-border-strong)] hover:bg-[var(--lumin-color-surface-hover)]',
          cell.inMonth ? '' : 'opacity-45'
        ]"
        @click="emit('select', cell.date)"
      >
        <span
          class="text-sm leading-none font-medium tabular-nums"
          :class="[
            isSameDay(cell.date, selected)
              ? 'text-[var(--lumin-color-primary)]'
              : cell.info.solar === todayYmd
                ? 'text-[var(--lumin-color-accent)]'
                : 'text-[var(--lumin-color-text)]'
          ]"
        >
          {{ cell.date.getDate() }}
        </span>
        <span class="w-full truncate text-center text-xs leading-tight" :class="subLine(cell).tone">
          {{ subLine(cell).text }}
        </span>
        <span class="flex h-1.5 items-center justify-center gap-0.5" aria-hidden="true">
          <i
            v-if="cell.holiday?.off"
            class="h-1.5 w-1.5 rounded-full bg-[var(--lumin-color-danger)]"
            :title="cell.holiday.name"
          />
          <i
            v-else-if="cell.holiday"
            class="h-1.5 w-1.5 rounded-full bg-[var(--lumin-color-warning)]"
            :title="`${cell.holiday.name}·调休上班`"
          />
          <i
            v-if="cell.info.festivals.length > 0 && !cell.holiday"
            class="h-1.5 w-1.5 rounded-full bg-[var(--lumin-color-accent)]"
            :title="cell.info.festivals.join('、')"
          />
          <i
            v-if="flags[index]"
            class="h-1.5 w-1.5 rounded-full bg-[var(--lumin-color-primary)]"
            title="纪念日"
          />
        </span>
      </button>
    </div>
  </div>
</template>
