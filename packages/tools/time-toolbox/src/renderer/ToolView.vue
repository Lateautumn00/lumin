<script setup lang="ts">
/**
 * 时间工具箱（time-toolbox）：时间戳转换 / 时区查看 / 时长计算 / Cron 解析与反向生成。
 * 三态：空态（各页签均带默认值）/ 加载态（全同步纯函数，豁免）/ 报错态（结构化错误码 + 中文文案）。
 */
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ArrowLeftRight, Clock, Copy } from '@lucide/vue'
import {
  NButton,
  NDatePicker,
  NInput,
  NInputNumber,
  NRadio,
  NRadioGroup,
  NSelect,
  NSwitch,
  NTabPane,
  NTabs,
  NText
} from 'naive-ui'
import type { StructuredError } from '@lumin/shared'

import {
  COMMON_TIME_ZONES,
  diffCalendar,
  formatDateTime,
  formatDuration,
  formatIso,
  formatOffset,
  isValidTimeZone,
  parseLocalDate,
  parseLocalDateTime,
  parseTimestamp,
  type CalendarDiff,
  type DurationParts,
  type TimestampMode
} from '../time'
import { buildCron, describeCron, nextCronRuns, parseCron, type ParsedCron } from '../cron'
import { toolError } from '../errors'
import {
  addDays,
  calcInterval,
  MAX_DATE_STEP,
  type DateCalcUnit,
  weekdayLabel,
  weekdayOf
} from '../date-calc'

const LOCAL_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

const TIMESTAMP_MODE_OPTIONS: { label: string; value: TimestampMode }[] = [
  { label: '自动识别', value: 'auto' },
  { label: '秒（10 位）', value: 'seconds' },
  { label: '毫秒（13 位）', value: 'milliseconds' }
]

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: '每 5 分钟', value: '*/5 * * * *' },
  { label: '工作日 9 点', value: '0 9 * * 1-5' },
  { label: '每月 1 日', value: '0 0 1 * *' },
  { label: '每年 1 月 1 日', value: '0 0 1 1 *' }
]

const activeTab = ref('timestamp')
const copiedLabel = ref('')
const clipboardError = ref<StructuredError | null>(null)

let copiedTimer: ReturnType<typeof setTimeout> | undefined
let tickTimer: ReturnType<typeof setInterval> | undefined

/** 毫秒 → datetime-local 输入值（本地时区，到秒） */
function toDateTimeLocalInput(ms: number): string {
  return formatDateTime(ms).replace(' ', 'T')
}

/** 向下取整到分钟 */
function floorToMinute(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000
}

/* ---------- Tab1 时间戳转换 ---------- */

const timestampInput = ref(String(Date.now()))
const timestampMode = ref<TimestampMode>('auto')

interface TimestampViewState {
  ms: number | null
  error: StructuredError | null
}

const timestampState = computed<TimestampViewState>(() => {
  const text = timestampInput.value.trim()
  if (text === '') return { ms: null, error: null }
  if (!/^-?\d+$/.test(text)) {
    return { ms: null, error: toolError('TT_INVALID_INPUT', '时间戳只能包含整数数字') }
  }
  const ms = parseTimestamp(text, timestampMode.value)
  if (ms === null) {
    return { ms: null, error: toolError('TT_OUT_OF_RANGE', '时间戳超出可表示范围') }
  }
  return { ms, error: null }
})

const timestampRows = computed<{ key: string; label: string; value: string }[]>(() => {
  const ms = timestampState.value.ms
  if (ms === null) return []
  return [
    { key: 'timestamp-local', label: '本地时间', value: formatDateTime(ms) },
    { key: 'timestamp-utc', label: 'UTC 时间', value: formatDateTime(ms, 'UTC') },
    { key: 'timestamp-iso', label: 'ISO 8601', value: formatIso(ms) },
    { key: 'timestamp-offset', label: '时区偏移', value: formatOffset(ms, LOCAL_TIME_ZONE) }
  ]
})

const reverseInput = ref(toDateTimeLocalInput(Date.now()))

const reverseState = computed<{ ms: number | null; error: StructuredError | null }>(() => {
  const text = reverseInput.value
  if (text === '') return { ms: null, error: null }
  const ms = parseLocalDateTime(text)
  if (ms === null) {
    return { ms: null, error: toolError('TT_INVALID_INPUT', '日期时间格式不正确') }
  }
  return { ms, error: null }
})

const reverseRows = computed<{ key: string; label: string; value: string }[]>(() => {
  const ms = reverseState.value.ms
  if (ms === null) return []
  return [
    { key: 'reverse-seconds', label: '秒级时间戳', value: String(Math.floor(ms / 1000)) },
    { key: 'reverse-milliseconds', label: '毫秒时间戳', value: String(ms) }
  ]
})

function onTimestampModeChange(value: string | number): void {
  if (value === 'auto' || value === 'seconds' || value === 'milliseconds') {
    timestampMode.value = value
  }
}

/* ---------- Tab2 时区查看 ---------- */

const customZone = ref('')
const zoneError = ref<StructuredError | null>(null)
const extraZones = ref<string[]>([])
const nowTick = ref(Date.now())

const zoneRows = computed(() => {
  const ms = nowTick.value
  const options = [
    ...COMMON_TIME_ZONES.map((zone) => ({ id: zone.id, label: zone.label })),
    ...extraZones.value.map((id) => ({ id, label: id }))
  ]
  return options.map((zone) => ({
    id: zone.id,
    label: zone.label,
    local: formatDateTime(ms, zone.id),
    offset: formatOffset(ms, zone.id)
  }))
})

function addZone(): void {
  const id = customZone.value.trim()
  if (id === '') {
    zoneError.value = toolError('TT_INVALID_INPUT', '请输入 IANA 时区名')
    return
  }
  if (!isValidTimeZone(id)) {
    zoneError.value = toolError('TT_INVALID_INPUT', `无法识别的时区：${id}`)
    return
  }
  const exists = COMMON_TIME_ZONES.some((zone) => zone.id === id) || extraZones.value.includes(id)
  if (exists) {
    zoneError.value = toolError('TT_INVALID_INPUT', '该时区已在列表中')
    return
  }
  extraZones.value = [...extraZones.value, id]
  customZone.value = ''
  zoneError.value = null
}

/* ---------- Tab3 时长计算 ---------- */

const initialNow = floorToMinute(Date.now())
const startInput = ref(toDateTimeLocalInput(initialNow))
const endInput = ref(toDateTimeLocalInput(initialNow + 3_600_000))

const durationState = computed<{ parts: DurationParts | null; error: StructuredError | null }>(
  () => {
    const start = parseLocalDateTime(startInput.value)
    const end = parseLocalDateTime(endInput.value)
    if (start === null || end === null) {
      return { parts: null, error: toolError('TT_INVALID_INPUT', '请填写完整的开始与结束时间') }
    }
    return { parts: formatDuration(end - start), error: null }
  }
)

const durationSummary = computed(() => {
  const parts = durationState.value.parts
  if (parts === null) return ''
  const prefix = parts.negative ? '−' : ''
  return `${prefix}${parts.days} 天 ${parts.hours} 小时 ${parts.minutes} 分钟 ${parts.seconds} 秒`
})

const durationRows = computed<{ key: string; label: string; value: string }[]>(() => {
  const parts = durationState.value.parts
  if (parts === null) return []
  return [
    { key: 'duration-seconds', label: '总秒数', value: parts.totalSeconds.toFixed(2) },
    { key: 'duration-minutes', label: '总分钟', value: parts.totalMinutes.toFixed(2) },
    { key: 'duration-hours', label: '总小时', value: parts.totalHours.toFixed(2) },
    { key: 'duration-days', label: '总天数', value: parts.totalDays.toFixed(2) }
  ]
})

function swapDuration(): void {
  const start = startInput.value
  startInput.value = endInput.value
  endInput.value = start
}

/* ---------- Tab5 日期差 ---------- */

/** 毫秒 → date 输入值（本地日期 YYYY-MM-DD） */
function toDateInput(ms: number): string {
  return formatDateTime(ms).slice(0, 10)
}

const diffStartInput = ref(toDateInput(Date.now()))
const diffEndInput = ref(toDateInput(Date.now()))

const dateDiffState = computed<{ diff: CalendarDiff | null; error: StructuredError | null }>(() => {
  const start = parseLocalDate(diffStartInput.value)
  const end = parseLocalDate(diffEndInput.value)
  if (start === null || end === null) {
    return { diff: null, error: toolError('TT_INVALID_INPUT', '请填写完整的开始与结束日期') }
  }
  return { diff: diffCalendar(start, end), error: null }
})

const dateDiffSummary = computed(() => {
  const diff = dateDiffState.value.diff
  if (diff === null) return ''
  const prefix = diff.negative ? '−' : ''
  return `${prefix}${diff.years} 年 ${diff.months} 个月 ${diff.days} 天`
})

const dateDiffRows = computed<{ key: string; label: string; value: string }[]>(() => {
  const diff = dateDiffState.value.diff
  if (diff === null) return []
  return [{ key: 'date-diff-total-days', label: '总天数', value: `${diff.totalDays} 天` }]
})

/* ---------- 日期计算器（M60：spec/time-toolbox.md M60 节） ---------- */

/** 本地零点毫秒（days 天后；内部重新归零时分秒） */
function localMidnightOffset(days: number): number {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** date 选择器时间戳 → YYYY-MM-DD（选择器值为本地零点，按本地分量取值） */
function tsToDateText(ts: number): string {
  const date = new Date(ts)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const todayTs = localMidnightOffset(0)
const tomorrowTs = localMidnightOffset(1)

/** 子模式：间隔 / 加减 */
const calcMode = ref<'interval' | 'add'>('interval')

// 间隔状态：起/止选择器（null = 已清空 → TT_INVALID_INPUT），结果始终取上一有效值
const intervalStartTs = ref<number | null>(todayTs)
const intervalEndTs = ref<number | null>(tomorrowTs)
const inclusive = ref(false)
const intervalError = ref<StructuredError | null>(null)
const lastInterval = ref({ start: todayTs, end: tomorrowTs })

watch([intervalStartTs, intervalEndTs], () => {
  const start = intervalStartTs.value
  const end = intervalEndTs.value
  if (start === null || end === null) {
    intervalError.value = toolError('TT_INVALID_INPUT', '请选择完整的开始与结束日期')
    return
  }
  lastInterval.value = { start, end }
  intervalError.value = null
})

const intervalRows = computed<{ key: string; label: string; value: string }[]>(() => {
  const { start, end } = lastInterval.value
  const result = calcInterval(tsToDateText(start), tsToDateText(end), inclusive.value)
  if (result === null) return []
  const absolute = result.negative ? '（绝对值）' : ''
  return [
    { key: 'calc-total-days', label: '总天数', value: `${result.totalDays} 天${absolute}` },
    { key: 'calc-weeks', label: '自然周', value: `${result.weeks} 周` },
    { key: 'calc-weekdays', label: '工作日', value: `${result.weekdays} 天` },
    {
      key: 'calc-weekday-range',
      label: '起止星期',
      value: `${weekdayLabel(result.startWeekday)} → ${weekdayLabel(result.endWeekday)}`
    }
  ]
})

// 加减状态：基准选择器 + 数量（整数 |N| ≤ 36500）+ 单位，结果同样保留上一有效值
const addBaseTs = ref<number | null>(todayTs)
const addCount = ref<number | null>(1)
const addUnit = ref<DateCalcUnit>('day')
const addError = ref<StructuredError | null>(null)
const lastAdd = ref({ base: todayTs, count: 1 })

watch([addBaseTs, addCount], () => {
  const base = addBaseTs.value
  const count = addCount.value
  if (base === null) {
    addError.value = toolError('TT_INVALID_INPUT', '请选择基准日期')
    return
  }
  if (count === null || !Number.isInteger(count) || Math.abs(count) > MAX_DATE_STEP) {
    addError.value = toolError('TT_INVALID_INPUT', '数量须为 -36500 ~ 36500 的整数')
    return
  }
  lastAdd.value = { base, count }
  addError.value = null
})

const addResult = computed<string | null>(() =>
  addDays(tsToDateText(lastAdd.value.base), lastAdd.value.count, addUnit.value)
)

const addResultWeekday = computed(() =>
  addResult.value === null ? '' : weekdayOf(addResult.value)
)

function onCalcModeChange(value: string | number): void {
  if (value === 'interval' || value === 'add') calcMode.value = value
}

function onCalcUnitChange(value: string | number): void {
  if (value === 'day' || value === 'week' || value === 'month' || value === 'year') {
    addUnit.value = value
  }
}

/* ---------- Tab4 Cron 解析 ---------- */

const cronInput = ref('*/5 * * * *')

interface CronViewState {
  parsed: ParsedCron | null
  description: string
  runs: number[]
  error: StructuredError | null
}

const cronState = computed<CronViewState>(() => {
  const text = cronInput.value.trim()
  if (text === '') return { parsed: null, description: '', runs: [], error: null }
  const result = parseCron(text)
  if (!result.ok) {
    return {
      parsed: null,
      description: '',
      runs: [],
      error: toolError('TT_INVALID_INPUT', result.message)
    }
  }
  const description = describeCron(result.value)
  const runs = nextCronRuns(result.value, Date.now())
  if (runs.length === 0) {
    return {
      parsed: result.value,
      description,
      runs,
      error: toolError('TT_OUT_OF_RANGE', '未来 60 天内没有触发时间')
    }
  }
  return { parsed: result.value, description, runs, error: null }
})

function applyCronPreset(value: string): void {
  cronInput.value = value
}

/* ---------- Tab4 反向生成（M55 §4.55） ---------- */

/** 反向生成勾选状态（空数组 = 未选 → 该字段通配 `*`） */
interface CronBuilderState {
  minutes: number[]
  hours: number[]
  daysOfMonth: number[]
  months: number[]
  daysOfWeek: number[]
}

type CronBuilderField = keyof CronBuilderState

/** 反向生成快捷预设（回填勾选状态） */
const CRON_BUILDER_PRESETS: { label: string; pick: Partial<CronBuilderState> }[] = [
  { label: '每 5 分钟', pick: { minutes: Array.from({ length: 12 }, (_, index) => index * 5) } },
  { label: '每小时整点', pick: { minutes: [0] } },
  { label: '每天 9 点', pick: { minutes: [0], hours: [9] } },
  { label: '每周一 9 点', pick: { minutes: [0], hours: [9], daysOfWeek: [1] } },
  { label: '每月 1 日', pick: { minutes: [0], hours: [0], daysOfMonth: [1] } }
]

/** 周字段选项（周一 → 周日；值 = Date#getDay，周日 0） */
const WEEK_OPTIONS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' }
] as const

const builder = reactive<CronBuilderState>({
  minutes: [],
  hours: [],
  daysOfMonth: [],
  months: [],
  daysOfWeek: []
})

const builderHasSelection = computed<boolean>(() =>
  (Object.keys(builder) as CronBuilderField[]).some((field) => builder[field].length > 0)
)

function toggleBuilder(field: CronBuilderField, value: number): void {
  const list = builder[field]
  const index = list.indexOf(value)
  if (index >= 0) list.splice(index, 1)
  else list.push(value)
}

function clearBuilder(): void {
  for (const field of Object.keys(builder) as CronBuilderField[]) builder[field] = []
}

function applyBuilderPreset(preset: { label: string; pick: Partial<CronBuilderState> }): void {
  clearBuilder()
  for (const field of Object.keys(preset.pick) as CronBuilderField[]) {
    builder[field] = [...(preset.pick[field] ?? [])]
  }
}

/** 生成表达式并回填解析框（cronState computed 自动联动描述与未来触发） */
function applyBuilder(): void {
  if (!builderHasSelection.value) return
  cronInput.value = buildCron({
    minutes: builder.minutes,
    hours: builder.hours,
    daysOfMonth: builder.daysOfMonth,
    months: builder.months,
    daysOfWeek: builder.daysOfWeek
  })
}

/* ---------- 通用 ---------- */

async function copyText(text: string, label: string): Promise<void> {
  if (text === '') return
  clipboardError.value = null
  try {
    await navigator.clipboard.writeText(text)
    copiedLabel.value = label
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      if (copiedLabel.value === label) copiedLabel.value = ''
    }, 1200)
  } catch {
    clipboardError.value = toolError('TT_CLIPBOARD_FAILED')
  }
}

onMounted(() => {
  tickTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (tickTimer !== undefined) clearInterval(tickTimer)
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">时间工具箱</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        时间戳与日期互转、多时区当前时间、时长计算与 Cron 表达式解析（本地处理，不联网）
      </p>
    </div>

    <!-- 页签仅作切换器，内容用 v-if 渲染；标签必须走 #tab 插槽（与 text-toolbox 同范式） -->
    <NTabs v-model:value="activeTab" type="line">
      <NTabPane name="timestamp">
        <template #tab>时间戳</template>
      </NTabPane>
      <NTabPane name="zones">
        <template #tab>时区</template>
      </NTabPane>
      <NTabPane name="duration">
        <template #tab>时长</template>
      </NTabPane>
      <NTabPane name="date-diff">
        <template #tab>日期差</template>
      </NTabPane>
      <NTabPane name="date-calc">
        <template #tab>日期计算器</template>
      </NTabPane>
      <NTabPane name="cron">
        <template #tab>Cron</template>
      </NTabPane>
    </NTabs>

    <!-- 时间戳转换 -->
    <div v-if="activeTab === 'timestamp'" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex min-w-64 flex-1 flex-col gap-1">
          <NText depth="2" class="text-sm">时间戳</NText>
          <NInput
            v-model:value="timestampInput"
            placeholder="1700000000 或 1700000000000"
            aria-label="时间戳"
          />
        </div>
        <div class="flex w-40 flex-col gap-1">
          <NText depth="2" class="text-sm">单位</NText>
          <NSelect
            :value="timestampMode"
            :options="TIMESTAMP_MODE_OPTIONS"
            aria-label="时间戳单位"
            @update:value="onTimestampModeChange"
          />
        </div>
      </div>

      <div
        v-if="timestampState.error !== null"
        role="alert"
        class="text-sm text-[var(--lumin-color-error, #d03050)]"
      >
        {{ timestampState.error.message }}（{{ timestampState.error.code }}）
      </div>

      <div v-if="timestampRows.length > 0" class="flex flex-col gap-1">
        <div
          v-for="row in timestampRows"
          :key="row.key"
          class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
        >
          <NText depth="2" class="w-20 shrink-0 text-xs">{{ row.label }}</NText>
          <NText class="flex-1 break-all font-mono text-sm">{{ row.value }}</NText>
          <NButton size="tiny" quaternary @click="copyText(row.value, row.key)">
            <Copy class="mr-1 h-3 w-3" />{{ copiedLabel === row.key ? '已复制' : '复制' }}
          </NButton>
        </div>
      </div>
      <NText v-else-if="timestampState.error === null" depth="3" class="text-sm">
        输入时间戳后实时显示本地时间、UTC、ISO 8601 与时区偏移。
      </NText>

      <div class="flex flex-col gap-2 border-t border-[var(--lumin-color-border, #e0e0e6)] pt-3">
        <div class="flex flex-col gap-1">
          <NText depth="2" class="text-sm">日期时间 → 时间戳</NText>
          <input
            v-model="reverseInput"
            type="datetime-local"
            step="1"
            aria-label="反向日期时间"
            class="w-fit rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1.5 text-sm"
          />
        </div>
        <div
          v-if="reverseState.error !== null"
          role="alert"
          class="text-sm text-[var(--lumin-color-error, #d03050)]"
        >
          {{ reverseState.error.message }}（{{ reverseState.error.code }}）
        </div>
        <div v-if="reverseRows.length > 0" class="flex flex-col gap-1">
          <div
            v-for="row in reverseRows"
            :key="row.key"
            class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
          >
            <NText depth="2" class="w-20 shrink-0 text-xs">{{ row.label }}</NText>
            <NText class="flex-1 break-all font-mono text-sm">{{ row.value }}</NText>
            <NButton size="tiny" quaternary @click="copyText(row.value, row.key)">
              <Copy class="mr-1 h-3 w-3" />{{ copiedLabel === row.key ? '已复制' : '复制' }}
            </NButton>
          </div>
        </div>
      </div>

      <NText depth="3" class="text-xs">
        自动识别：去符号后 ≤11 位按秒、&gt;11 位按毫秒；支持 ±8.64e15 毫秒内的 Date 范围。
      </NText>
    </div>

    <!-- 时区查看 -->
    <div v-if="activeTab === 'zones'" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-end gap-2">
        <div class="flex min-w-64 flex-1 flex-col gap-1">
          <NText depth="2" class="text-sm">自定义时区（IANA 名称）</NText>
          <NInput
            v-model:value="customZone"
            placeholder="如 Asia/Kolkata"
            aria-label="自定义时区"
            @keyup.enter="addZone"
          />
        </div>
        <NButton @click="addZone">添加</NButton>
      </div>

      <div
        v-if="zoneError !== null"
        role="alert"
        class="text-sm text-[var(--lumin-color-error, #d03050)]"
      >
        {{ zoneError.message }}（{{ zoneError.code }}）<template
          v-if="zoneError.detail !== undefined"
          >：{{ zoneError.detail }}</template
        >
      </div>

      <div
        class="overflow-hidden rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)]"
      >
        <div
          class="grid grid-cols-[1.4fr_1.4fr_0.6fr] gap-2 border-b border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2 text-xs text-[var(--lumin-color-text-secondary)]"
        >
          <span>时区</span>
          <span>当前时间</span>
          <span class="text-right">UTC 偏移</span>
        </div>
        <div
          v-for="zone in zoneRows"
          :key="zone.id"
          class="grid grid-cols-[1.4fr_1.4fr_0.6fr] items-center gap-2 px-3 py-1.5 text-sm"
          data-zone-row
        >
          <NText class="truncate" :title="zone.id">{{ zone.label }}</NText>
          <NText class="font-mono">{{ zone.local }}</NText>
          <NText depth="2" class="text-right font-mono">{{ zone.offset }}</NText>
        </div>
      </div>

      <NText depth="3" class="text-xs">时区数据来自系统 Intl，列表每秒自动刷新。</NText>
    </div>

    <!-- 时长计算 -->
    <div v-if="activeTab === 'duration'" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex flex-col gap-1">
          <NText depth="2" class="text-sm">开始时间</NText>
          <input
            v-model="startInput"
            type="datetime-local"
            step="1"
            aria-label="开始时间"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1.5 text-sm"
          />
        </div>
        <NButton quaternary aria-label="交换起止时间" @click="swapDuration">
          <ArrowLeftRight class="h-4 w-4" />
        </NButton>
        <div class="flex flex-col gap-1">
          <NText depth="2" class="text-sm">结束时间</NText>
          <input
            v-model="endInput"
            type="datetime-local"
            step="1"
            aria-label="结束时间"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div
        v-if="durationState.error !== null"
        role="alert"
        class="text-sm text-[var(--lumin-color-error, #d03050)]"
      >
        {{ durationState.error.message }}（{{ durationState.error.code }}）
      </div>
      <template v-else-if="durationState.parts !== null">
        <NText class="text-lg font-semibold">{{ durationSummary }}</NText>
        <div class="flex flex-col gap-1">
          <div
            v-for="row in durationRows"
            :key="row.key"
            class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
          >
            <NText depth="2" class="w-20 shrink-0 text-xs">{{ row.label }}</NText>
            <NText class="flex-1 font-mono text-sm">{{ row.value }}</NText>
            <NButton size="tiny" quaternary @click="copyText(row.value, row.key)">
              <Copy class="mr-1 h-3 w-3" />{{ copiedLabel === row.key ? '已复制' : '复制' }}
            </NButton>
          </div>
        </div>
      </template>

      <NText depth="3" class="text-xs"> 结束时间早于开始时间时按绝对差展示并加「−」。 </NText>
    </div>

    <!-- 日期差 -->
    <div v-if="activeTab === 'date-diff'" class="flex max-w-2xl flex-col gap-3">
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex flex-col gap-1">
          <NText depth="2" class="text-sm">开始日期</NText>
          <input
            v-model="diffStartInput"
            type="date"
            aria-label="开始日期"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1.5 text-sm"
          />
        </div>
        <div class="flex flex-col gap-1">
          <NText depth="2" class="text-sm">结束日期</NText>
          <input
            v-model="diffEndInput"
            type="date"
            aria-label="结束日期"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div
        v-if="dateDiffState.error !== null"
        role="alert"
        class="text-sm text-[var(--lumin-color-error, #d03050)]"
      >
        {{ dateDiffState.error.message }}（{{ dateDiffState.error.code }}）
      </div>
      <template v-else-if="dateDiffState.diff !== null">
        <NText class="text-lg font-semibold">{{ dateDiffSummary }}</NText>
        <div class="flex flex-col gap-1">
          <div
            v-for="row in dateDiffRows"
            :key="row.key"
            class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
          >
            <NText depth="2" class="w-20 shrink-0 text-xs">{{ row.label }}</NText>
            <NText class="flex-1 font-mono text-sm">{{ row.value }}</NText>
            <NButton size="tiny" quaternary @click="copyText(row.value, row.key)">
              <Copy class="mr-1 h-3 w-3" />{{ copiedLabel === row.key ? '已复制' : '复制' }}
            </NButton>
          </div>
        </div>
      </template>

      <NText depth="3" class="text-xs">
        按本地日历日计算；月末按「加月截断」借位（如 1-31 → 3-01 为 1 个月 1 天）。
      </NText>
    </div>

    <!-- 日期计算器（M60）：间隔 / 加减，纯 renderer 零 IPC -->
    <div v-if="activeTab === 'date-calc'" class="flex max-w-2xl flex-col gap-3">
      <div class="flex flex-wrap items-center gap-4">
        <NRadioGroup :value="calcMode" size="small" @update:value="onCalcModeChange">
          <NRadio value="interval">间隔</NRadio>
          <NRadio value="add">加减</NRadio>
        </NRadioGroup>
        <div v-if="calcMode === 'interval'" class="flex items-center gap-2">
          <NSwitch v-model:value="inclusive" aria-label="含头含尾" />
          <NText depth="2" class="text-sm">含头含尾</NText>
        </div>
      </div>

      <!-- 间隔：起/止日期 + 总天数/自然周/工作日/起止星期 -->
      <template v-if="calcMode === 'interval'">
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-1">
            <NText depth="2" class="text-sm">开始日期</NText>
            <NDatePicker
              v-model:value="intervalStartTs"
              type="date"
              placeholder="开始日期"
              class="w-44"
            />
          </div>
          <div class="flex flex-col gap-1">
            <NText depth="2" class="text-sm">结束日期</NText>
            <NDatePicker
              v-model:value="intervalEndTs"
              type="date"
              placeholder="结束日期"
              class="w-44"
            />
          </div>
        </div>

        <div
          v-if="intervalError !== null"
          role="alert"
          class="text-sm text-[var(--lumin-color-error, #d03050)]"
        >
          {{ intervalError.message }}（{{ intervalError.code }}）
        </div>

        <div v-if="intervalRows.length > 0" class="flex flex-col gap-1">
          <div
            v-for="row in intervalRows"
            :key="row.key"
            class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
          >
            <NText depth="2" class="w-20 shrink-0 text-xs">{{ row.label }}</NText>
            <NText class="flex-1 font-mono text-sm">{{ row.value }}</NText>
          </div>
        </div>

        <NText depth="3" class="text-xs">
          工作日仅统计周一至周五（跳过周六日，未计法定节假日与调休）；止早于起按绝对值计算并标注「（绝对值）」。
        </NText>
      </template>

      <!-- 加减：基准日期 + 数量/单位 + 结果日期与星期 -->
      <template v-else>
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-1">
            <NText depth="2" class="text-sm">基准日期</NText>
            <NDatePicker
              v-model:value="addBaseTs"
              type="date"
              placeholder="基准日期"
              class="w-44"
            />
          </div>
          <div class="flex flex-col gap-1">
            <NText depth="2" class="text-sm">数量</NText>
            <NInputNumber
              v-model:value="addCount"
              :step="1"
              placeholder="整数"
              aria-label="数量"
              class="w-36"
            />
          </div>
          <div class="flex flex-col gap-1">
            <NText depth="2" class="text-sm">单位</NText>
            <NRadioGroup :value="addUnit" size="small" @update:value="onCalcUnitChange">
              <NRadio value="day">天</NRadio>
              <NRadio value="week">周</NRadio>
              <NRadio value="month">月</NRadio>
              <NRadio value="year">年</NRadio>
            </NRadioGroup>
          </div>
        </div>

        <div
          v-if="addError !== null"
          role="alert"
          class="text-sm text-[var(--lumin-color-error, #d03050)]"
        >
          {{ addError.message }}（{{ addError.code }}）
        </div>

        <div
          v-if="addResult !== null"
          class="flex items-baseline gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
        >
          <NText depth="2" class="w-20 shrink-0 text-xs">结果日期</NText>
          <NText class="flex-1 font-mono text-lg font-semibold">{{ addResult }}</NText>
          <NText depth="2" class="text-sm">{{ addResultWeekday }}</NText>
        </div>

        <NText depth="3" class="text-xs">
          月/年按日历进位，日溢出钳制到月末（如 1/31 + 1 月 → 2/28，闰年 → 2/29）；数量为整数且 |N|
          ≤ 36500。
        </NText>
      </template>
    </div>

    <!-- Cron 解析 -->
    <div v-if="activeTab === 'cron'" class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <NText depth="2" class="text-sm">Cron 表达式（分 时 日 月 周）</NText>
        <NInput v-model:value="cronInput" placeholder="*/5 * * * *" aria-label="Cron 表达式" />
      </div>

      <div class="flex flex-wrap gap-2">
        <NButton
          v-for="preset in CRON_PRESETS"
          :key="preset.value"
          size="tiny"
          quaternary
          @click="applyCronPreset(preset.value)"
        >
          {{ preset.label }}
        </NButton>
      </div>

      <div
        v-if="cronState.error !== null"
        role="alert"
        class="text-sm text-[var(--lumin-color-error, #d03050)]"
      >
        {{ cronState.error.message }}（{{ cronState.error.code }}）<template
          v-if="cronState.error.detail !== undefined"
          >：{{ cronState.error.detail }}</template
        >
      </div>

      <template v-else-if="cronState.parsed !== null">
        <div class="flex items-center gap-2 text-sm">
          <Clock class="h-4 w-4 text-[var(--lumin-color-text-secondary)]" />
          <NText>描述：{{ cronState.description }}</NText>
        </div>
        <div class="flex flex-col gap-1">
          <NText depth="2" class="text-sm font-medium">未来 5 次触发</NText>
          <div
            v-for="(run, index) in cronState.runs"
            :key="run"
            data-cron-run
            class="flex items-center gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-1.5 text-sm"
          >
            <NText depth="3" class="w-6 text-xs">#{{ index + 1 }}</NText>
            <NText class="font-mono">{{ formatDateTime(run) }}</NText>
          </div>
        </div>
      </template>
      <NText v-else depth="3" class="text-sm">
        输入 5 字段表达式后显示中文描述与未来 5 次触发时间。
      </NText>

      <!-- 反向生成（M55 §4.55）：勾选矩阵 → 表达式回填 -->
      <div
        class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] p-3"
      >
        <div class="flex flex-wrap items-center gap-2">
          <NText depth="2" class="text-sm font-medium">反向生成</NText>
          <NButton
            size="tiny"
            type="primary"
            data-testid="cron-generate"
            :disabled="!builderHasSelection"
            @click="applyBuilder"
          >
            生成表达式
          </NButton>
          <NButton size="tiny" quaternary data-testid="cron-clear" @click="clearBuilder">
            清空勾选
          </NButton>
          <NText depth="3" class="text-xs">
            勾选后生成并回填上方表达式框，解析结果自动联动；未勾选的字段按通配（*）处理
          </NText>
        </div>

        <div class="flex flex-wrap gap-2">
          <NButton
            v-for="preset in CRON_BUILDER_PRESETS"
            :key="preset.label"
            size="tiny"
            quaternary
            data-testid="cron-bp"
            @click="applyBuilderPreset(preset)"
          >
            {{ preset.label }}
          </NButton>
        </div>

        <div class="flex flex-col gap-1">
          <NText depth="3" class="text-xs">分钟（已选 {{ builder.minutes.length }}）</NText>
          <div class="grid grid-cols-12 gap-1">
            <button
              v-for="minute in 60"
              :key="`m-${minute}`"
              type="button"
              :data-testid="`cron-minute-${minute - 1}`"
              :aria-pressed="builder.minutes.includes(minute - 1)"
              class="rounded-[var(--lumin-radius-md)] border py-0.5 text-xs transition-colors"
              :class="
                builder.minutes.includes(minute - 1)
                  ? 'border-[var(--lumin-color-primary)] bg-[var(--lumin-color-primary)] text-white'
                  : 'border-[var(--lumin-color-border)] text-[var(--lumin-color-text-secondary)] hover:border-[var(--lumin-color-primary)]'
              "
              @click="toggleBuilder('minutes', minute - 1)"
            >
              {{ minute - 1 }}
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <NText depth="3" class="text-xs">小时（已选 {{ builder.hours.length }}）</NText>
          <div class="grid grid-cols-12 gap-1">
            <button
              v-for="hour in 24"
              :key="`h-${hour}`"
              type="button"
              :data-testid="`cron-hour-${hour - 1}`"
              :aria-pressed="builder.hours.includes(hour - 1)"
              class="rounded-[var(--lumin-radius-md)] border py-0.5 text-xs transition-colors"
              :class="
                builder.hours.includes(hour - 1)
                  ? 'border-[var(--lumin-color-primary)] bg-[var(--lumin-color-primary)] text-white'
                  : 'border-[var(--lumin-color-border)] text-[var(--lumin-color-text-secondary)] hover:border-[var(--lumin-color-primary)]'
              "
              @click="toggleBuilder('hours', hour - 1)"
            >
              {{ hour - 1 }}
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <NText depth="3" class="text-xs">日（已选 {{ builder.daysOfMonth.length }}）</NText>
          <div class="grid grid-cols-12 gap-1">
            <button
              v-for="day in 31"
              :key="`d-${day}`"
              type="button"
              :data-testid="`cron-dom-${day}`"
              :aria-pressed="builder.daysOfMonth.includes(day)"
              class="rounded-[var(--lumin-radius-md)] border py-0.5 text-xs transition-colors"
              :class="
                builder.daysOfMonth.includes(day)
                  ? 'border-[var(--lumin-color-primary)] bg-[var(--lumin-color-primary)] text-white'
                  : 'border-[var(--lumin-color-border)] text-[var(--lumin-color-text-secondary)] hover:border-[var(--lumin-color-primary)]'
              "
              @click="toggleBuilder('daysOfMonth', day)"
            >
              {{ day }}
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <NText depth="3" class="text-xs">月（已选 {{ builder.months.length }}）</NText>
          <div class="grid grid-cols-12 gap-1">
            <button
              v-for="month in 12"
              :key="`mo-${month}`"
              type="button"
              :data-testid="`cron-month-${month}`"
              :aria-pressed="builder.months.includes(month)"
              class="rounded-[var(--lumin-radius-md)] border py-0.5 text-xs transition-colors"
              :class="
                builder.months.includes(month)
                  ? 'border-[var(--lumin-color-primary)] bg-[var(--lumin-color-primary)] text-white'
                  : 'border-[var(--lumin-color-border)] text-[var(--lumin-color-text-secondary)] hover:border-[var(--lumin-color-primary)]'
              "
              @click="toggleBuilder('months', month)"
            >
              {{ month }}月
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <NText depth="3" class="text-xs">周（已选 {{ builder.daysOfWeek.length }}）</NText>
          <div class="grid grid-cols-7 gap-1">
            <button
              v-for="weekday in WEEK_OPTIONS"
              :key="`w-${weekday.value}`"
              type="button"
              :data-testid="`cron-dow-${weekday.value}`"
              :aria-pressed="builder.daysOfWeek.includes(weekday.value)"
              class="rounded-[var(--lumin-radius-md)] border py-0.5 text-xs transition-colors"
              :class="
                builder.daysOfWeek.includes(weekday.value)
                  ? 'border-[var(--lumin-color-primary)] bg-[var(--lumin-color-primary)] text-white'
                  : 'border-[var(--lumin-color-border)] text-[var(--lumin-color-text-secondary)] hover:border-[var(--lumin-color-primary)]'
              "
              @click="toggleBuilder('daysOfWeek', weekday.value)"
            >
              {{ weekday.label }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 报错态：复制失败（全局） -->
    <div
      v-if="clipboardError !== null"
      role="alert"
      class="text-sm text-[var(--lumin-color-error, #d03050)]"
    >
      {{ clipboardError.message }}（{{ clipboardError.code }}）
    </div>
  </div>
</template>
