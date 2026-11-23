<script setup lang="ts">
/**
 * @file 日历工具主视图（公历/农历/节假日/纪念日/黄历）
 * @author cuilanchao
 * @date 2026-11-23
 * @description 农历库动态 import 分包（R5）：加载态/失败可重试；纯 renderer 无 IPC
 */
import { computed, onMounted, ref } from 'vue'
import { NAlert, NButton, NSpin } from 'naive-ui'
import { ChevronLeft, ChevronRight, Plus } from '@lucide/vue'
import type { StructuredError } from '@lumin/shared'

import type { DayInfo, HuangJi, MonthCell } from '../lunar'
import type { HolidayInfo } from '../holidays'
import type { Anniversary } from '../anniversaries'
import MonthGrid from './MonthGrid.vue'
import DayDetail, { type DayAnniversary } from './DayDetail.vue'
import AnniversaryModal from './AnniversaryModal.vue'

type LunarLib = typeof import('../lunar')
type AnnLib = typeof import('../anniversaries')
type HolidayLib = typeof import('../holidays')

/** 报错态错误码（spec/calendar.md §4） */
const ERROR_MESSAGES: Record<string, string> = {
  CALENDAR_LIB_LOAD_FAILED: '日历引擎加载失败，请重试',
  CALENDAR_COMPUTE_FAILED: '日期计算失败，请重试'
}

function toolError(code: string): StructuredError {
  return { code, message: ERROR_MESSAGES[code] ?? code }
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function ymd(date: Date): string {
  const m = date.getMonth() + 1
  const d = date.getDate()
  return `${date.getFullYear()}-${m < 10 ? '0' + m : m}-${d < 10 ? '0' + d : d}`
}

/* ---------- 动态加载（加载态 / 报错态） ---------- */

const lunarLib = ref<LunarLib | null>(null)
const annLib = ref<AnnLib | null>(null)
const holidayLib = ref<HolidayLib | null>(null)
const loading = ref(true)
const loadError = ref<StructuredError | null>(null)
const computeError = ref<StructuredError | null>(null)
let loadSeq = 0

async function loadLib(): Promise<void> {
  const seq = ++loadSeq
  loading.value = true
  loadError.value = null
  try {
    const [lunar, ann, holiday] = await Promise.all([
      import('../lunar'),
      import('../anniversaries'),
      import('../holidays')
    ])
    if (seq !== loadSeq) return
    lunarLib.value = lunar
    annLib.value = ann
    holidayLib.value = holiday
    anniversaries.value = ann.loadAnniversaries()
  } catch {
    if (seq !== loadSeq) return
    loadError.value = toolError('CALENDAR_LIB_LOAD_FAILED')
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

/* ---------- 视图状态 ---------- */

const view = ref({ year: startOfToday().getFullYear(), month: startOfToday().getMonth() + 1 })
const selected = ref<Date>(startOfToday())
const anniversaries = ref<Anniversary[]>([])
const modalShow = ref(false)
const saveError = ref('')

function tryCompute<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    computeError.value = toolError('CALENDAR_COMPUTE_FAILED')
    return fallback
  }
}

function resetComputeError(): void {
  computeError.value = null
}

const grid = computed<MonthCell[]>(() => {
  const lib = lunarLib.value
  if (!lib) return []
  return tryCompute(() => lib.getMonthGrid(view.value.year, view.value.month), [])
})

const flags = computed<boolean[]>(() => {
  const ann = annLib.value
  if (!ann) return grid.value.map(() => false)
  return grid.value.map((cell) =>
    anniversaries.value.some((a) => ann.matchesDay(a, cell.date, cell.info))
  )
})

const selectedInfo = computed<DayInfo | null>(() => {
  const lib = lunarLib.value
  if (!lib) return null
  return tryCompute(() => lib.getDayInfo(selected.value), null)
})

const selectedHuangJi = computed<HuangJi | null>(() => {
  const lib = lunarLib.value
  if (!lib) return null
  return tryCompute(() => lib.getHuangJi(selected.value), null)
})

const selectedHoliday = computed<HolidayInfo | null>(() => {
  const holiday = holidayLib.value
  if (!holiday) return null
  const d = selected.value
  return tryCompute(
    () => holiday.getHolidayInfo(d.getFullYear(), d.getMonth() + 1, d.getDate()),
    null
  )
})

const selectedAnniversaries = computed<DayAnniversary[]>(() => {
  const ann = annLib.value
  const info = selectedInfo.value
  if (!ann || !info) return []
  const today = startOfToday()
  return anniversaries.value
    .filter((a) => ann.matchesDay(a, selected.value, info))
    .map((a) => ({ anniversary: a, countdown: ann.formatCountdown(a, today) }))
})

const todayYmd = computed(() => ymd(startOfToday()))

/* ---------- 导航 ---------- */

function syncSelectionToMonth(): void {
  const today = startOfToday()
  if (today.getFullYear() === view.value.year && today.getMonth() + 1 === view.value.month) {
    selected.value = today
  } else {
    selected.value = new Date(view.value.year, view.value.month - 1, 1)
  }
}

function goto(delta: number): void {
  const d = new Date(view.value.year, view.value.month - 1 + delta, 1)
  view.value = { year: d.getFullYear(), month: d.getMonth() + 1 }
  syncSelectionToMonth()
  resetComputeError()
}

function goToday(): void {
  const today = startOfToday()
  view.value = { year: today.getFullYear(), month: today.getMonth() + 1 }
  selected.value = today
  resetComputeError()
}

function selectDate(date: Date): void {
  selected.value = date
  resetComputeError()
}

/* ---------- 纪念日 ---------- */

function onConfirm(list: Anniversary[]): void {
  anniversaries.value = list
  const ok = annLib.value?.saveAnniversaries(list) ?? false
  saveError.value = ok ? '' : '保存失败：存储空间不足，数据已在本会话保留，请释放空间后重新保存'
}

function countdownOf(item: Anniversary): string {
  const ann = annLib.value
  if (!ann) return ''
  return ann.formatCountdown(item, startOfToday())
}

onMounted(loadLib)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <header class="flex flex-wrap items-center gap-2">
      <h1 class="text-base font-semibold">日历</h1>
      <div class="ml-auto flex items-center gap-1">
        <NButton size="small" quaternary aria-label="上个月" @click="goto(-1)">
          <ChevronLeft class="h-4 w-4" />
        </NButton>
        <span class="min-w-28 text-center text-sm font-semibold tabular-nums">
          {{ view.year }} 年 {{ view.month }} 月
        </span>
        <NButton size="small" quaternary aria-label="下个月" @click="goto(1)">
          <ChevronRight class="h-4 w-4" />
        </NButton>
        <NButton size="small" @click="goToday">今天</NButton>
        <NButton size="small" type="primary" @click="modalShow = true">
          <Plus class="mr-1 h-3.5 w-3.5" />纪念日管理
        </NButton>
      </div>
    </header>

    <!-- 加载态：农历引擎动态分包加载 -->
    <div
      v-if="loading"
      class="flex min-h-40 flex-1 items-center justify-center gap-2 text-sm text-[var(--lumin-color-text-secondary)]"
      role="status"
    >
      <NSpin :size="16" />
      正在加载日历引擎…
    </div>

    <!-- 报错态：结构化错误码 + 重试 -->
    <NAlert
      v-else-if="loadError !== null"
      type="error"
      :title="loadError.message"
      class="mt-6"
      role="alert"
    >
      <div class="flex items-center gap-3">
        <span>错误码：{{ loadError.code }}</span>
        <NButton size="small" type="primary" @click="loadLib">重试</NButton>
      </div>
    </NAlert>

    <template v-else>
      <NAlert v-if="saveError !== ''" type="warning" closable role="alert" @close="saveError = ''">
        {{ saveError }}
      </NAlert>
      <NAlert v-if="computeError !== null" type="error" role="alert">
        <div class="flex items-center gap-3">
          <span>{{ computeError.message }}（{{ computeError.code }}）</span>
          <NButton size="small" @click="goToday">重试</NButton>
        </div>
      </NAlert>

      <!-- 月格 + 详情：xl 横排；以下换行到下方并整体滚动 -->
      <div
        class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto xl:flex-row xl:overflow-hidden"
      >
        <div class="min-w-0 flex-1 xl:min-w-72 xl:overflow-y-auto">
          <MonthGrid
            :cells="grid"
            :selected="selected"
            :today-ymd="todayYmd"
            :flags="flags"
            @select="selectDate"
          />
        </div>
        <div class="w-full shrink-0 xl:w-84 xl:min-h-0 xl:overflow-y-auto">
          <DayDetail
            v-if="selectedInfo !== null && selectedHuangJi !== null"
            :info="selectedInfo"
            :huang-ji="selectedHuangJi"
            :holiday="selectedHoliday"
            :anniversaries="selectedAnniversaries"
          />
        </div>
      </div>
    </template>

    <AnniversaryModal
      :show="modalShow"
      :list="anniversaries"
      :countdown="countdownOf"
      @update:show="modalShow = $event"
      @confirm="onConfirm"
    />
  </div>
</template>
