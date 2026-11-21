<script setup lang="ts">
/**
 * 实用工具（misc-toolbox）：子网 / IP 计算器 + 秒表 / 倒计时 / 番茄钟。
 * 三态：空态（IP 引导 + 预设、秒表 00:00.00）/ 加载态（全同步纯函数与本地计时，豁免）/ 报错态（MT_CIDR_INVALID + 中文文案）。
 * 计时基于 performance.now 差值，setInterval 仅刷新显示；卸载时清理 interval / AudioContext / 标题标记。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NInput,
  NInputNumber,
  NProgress,
  NRadioButton,
  NRadioGroup,
  NTabPane,
  NTabs,
  NTag,
  NText
} from 'naive-ui'
import { Flag, Pause, Play, RotateCcw, SkipForward } from '@lucide/vue'
import type { StructuredError } from '@lumin/shared'

import { errorMessage } from '../errors'
import { parseAndCompute, type SubnetInfo } from '../ip'
import {
  MAX_LAPS,
  TICK_INTERVAL_MS,
  countdownTotalSeconds,
  formatClock,
  formatDuration,
  nextPhase,
  phaseLabel,
  pushLap,
  splitLap,
  type Lap,
  type PomodoroPhase,
  type PomodoroState
} from '../clock'

/* ---------- 页签一：子网 / IP ---------- */

const activeTab = ref('ip')

const CIDR_PRESETS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.1.0/24', '0.0.0.0/0'] as const

const cidrInput = ref('')
const subnet = ref<SubnetInfo | null>(null)
const subnetError = ref<StructuredError | null>(null)

const subnetRows = computed<{ key: string; label: string; value: string }[]>(() => {
  const info = subnet.value
  if (info === null) return []
  return [
    { key: 'network', label: '网络地址', value: info.network },
    { key: 'broadcast', label: '广播地址', value: info.broadcast },
    { key: 'netmask', label: '子网掩码', value: info.netmask },
    { key: 'wildcard', label: '反掩码', value: info.wildcard },
    { key: 'prefix', label: '前缀长度', value: `/${info.prefix}` },
    { key: 'host-range', label: '可用主机范围', value: `${info.firstHost} – ${info.lastHost}` },
    { key: 'host-count', label: '可用主机数', value: String(info.hostCount) },
    { key: 'class', label: 'IP 类别', value: `${info.ipClass} 类` },
    { key: 'private', label: '是否私有', value: info.isPrivate ? '是' : '否' },
    { key: 'loopback', label: '是否回环', value: info.isLoopback ? '是' : '否' },
    { key: 'netmask-binary', label: '掩码二进制', value: info.netmaskBinary }
  ]
})

function runSubnet(): void {
  const result = parseAndCompute(cidrInput.value)
  if (!result.ok) {
    subnet.value = null
    subnetError.value = result.error
    return
  }
  subnetError.value = null
  subnet.value = result.value
}

function applyPreset(value: string): void {
  cidrInput.value = value
  runSubnet()
}

function resetSubnet(): void {
  cidrInput.value = ''
  subnet.value = null
  subnetError.value = null
}

/* ---------- 页签二：计时器（公共刷新） ---------- */

type TimerMode = 'stopwatch' | 'countdown' | 'pomodoro'

const timerMode = ref<TimerMode>('stopwatch')
const pendingMode = ref<TimerMode | null>(null)

/** 显示刷新时钟（performance.now 差值，仅驱动渲染，不参与计时精度） */
const nowMs = ref(0)
let ticker: number | undefined

function startTicker(): void {
  if (ticker !== undefined) return
  nowMs.value = performance.now()
  ticker = window.setInterval(() => {
    nowMs.value = performance.now()
  }, TICK_INTERVAL_MS)
}

function stopTicker(): void {
  if (ticker === undefined) return
  window.clearInterval(ticker)
  ticker = undefined
}

function stopTickerIfIdle(): void {
  if (!swRunning.value && !cdRunning.value && !pomoRunning.value) stopTicker()
}

/* 结束提示：短蜂鸣（AudioContext，无音频文件）+ document.title 追加 ⏰ */

let audioContext: AudioContext | undefined
let titleFlagged = false

function beep(): void {
  try {
    audioContext ??= new AudioContext()
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    gain.gain.value = 0.08
    oscillator.connect(gain)
    gain.connect(audioContext.destination)
    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.35)
  } catch {
    /* 无音频设备或上下文创建失败时静默降级，不阻断计时 */
  }
}

function notifyAlarm(): void {
  beep()
  if (titleFlagged) return
  titleFlagged = true
  document.title = document.title === '' ? '⏰' : `${document.title} ⏰`
}

function clearTitleFlag(): void {
  if (!titleFlagged) return
  titleFlagged = false
  if (document.title.endsWith(' ⏰')) document.title = document.title.slice(0, -2)
}

/* ---------- 2.1 秒表 ---------- */

const swRunning = ref(false)
const swAccumulated = ref(0)
const swStartedAt = ref(0)
const swLaps = ref<Lap[]>([])

const swElapsed = computed(() =>
  swRunning.value ? swAccumulated.value + (nowMs.value - swStartedAt.value) : swAccumulated.value
)
const swDisplay = computed(() => formatClock(swElapsed.value))

function swStart(): void {
  if (swRunning.value) return
  swStartedAt.value = performance.now()
  swRunning.value = true
  startTicker()
}

function swPause(): void {
  if (!swRunning.value) return
  swAccumulated.value = swElapsed.value
  swRunning.value = false
  stopTickerIfIdle()
}

function swReset(): void {
  swRunning.value = false
  swAccumulated.value = 0
  swStartedAt.value = 0
  swLaps.value = []
  stopTickerIfIdle()
}

function swLap(): void {
  if (!swRunning.value) return
  const previousTotal = swLaps.value[0]?.totalMs ?? 0
  swLaps.value = pushLap(swLaps.value, splitLap(swElapsed.value, previousTotal))
}

/* ---------- 2.2 倒计时 ---------- */

const cdHours = ref<number | null>(0)
const cdMinutes = ref<number | null>(5)
const cdSeconds = ref<number | null>(0)

const cdTotalMs = computed(
  () =>
    countdownTotalSeconds({
      hours: cdHours.value ?? 0,
      minutes: cdMinutes.value ?? 0,
      seconds: cdSeconds.value ?? 0
    }) * 1000
)

const cdRunning = ref(false)
const cdEndAt = ref(0)
const cdRemainMs = ref(cdTotalMs.value)
const cdFinished = ref(false)

const cdRemaining = computed(() =>
  Math.max(0, cdRunning.value ? cdEndAt.value - nowMs.value : cdRemainMs.value)
)
const cdDisplay = computed(() => formatDuration(Math.ceil(cdRemaining.value / 1000)))

watch([cdHours, cdMinutes, cdSeconds], () => {
  if (cdRunning.value || cdFinished.value) return
  cdRemainMs.value = cdTotalMs.value
})

watch(cdRemaining, (value) => {
  if (!cdRunning.value || value > 0) return
  cdRunning.value = false
  cdFinished.value = true
  cdRemainMs.value = 0
  stopTickerIfIdle()
  notifyAlarm()
})

function cdStart(): void {
  if (cdRunning.value) return
  if (cdRemainMs.value <= 0) cdRemainMs.value = cdTotalMs.value
  if (cdRemainMs.value <= 0) return
  cdFinished.value = false
  clearTitleFlag()
  cdEndAt.value = performance.now() + cdRemainMs.value
  cdRunning.value = true
  startTicker()
}

function cdPause(): void {
  if (!cdRunning.value) return
  cdRemainMs.value = cdRemaining.value
  cdRunning.value = false
  stopTickerIfIdle()
}

function cdReset(): void {
  cdRunning.value = false
  cdFinished.value = false
  cdRemainMs.value = cdTotalMs.value
  clearTitleFlag()
  stopTickerIfIdle()
}

/* ---------- 2.3 番茄钟 ---------- */

const pomoFocusMin = ref<number | null>(25)
const pomoShortMin = ref<number | null>(5)
const pomoLongMin = ref<number | null>(15)
const pomoState = ref<PomodoroState>({ phase: 'focus', completedFocus: 0 })
const pomoRunning = ref(false)
const pomoEndAt = ref(0)
const pomoAwaiting = ref(false)

function phaseMinutes(phase: PomodoroPhase): number {
  if (phase === 'focus') return pomoFocusMin.value ?? 0
  if (phase === 'short-break') return pomoShortMin.value ?? 0
  return pomoLongMin.value ?? 0
}

const pomoPhaseMs = computed(() => phaseMinutes(pomoState.value.phase) * 60_000)
const pomoRemainMs = ref(pomoPhaseMs.value)

const pomoRemaining = computed(() =>
  Math.max(0, pomoRunning.value ? pomoEndAt.value - nowMs.value : pomoRemainMs.value)
)
const pomoDisplay = computed(() => formatDuration(Math.ceil(pomoRemaining.value / 1000)))
const pomoPercent = computed(() => {
  const total = pomoPhaseMs.value
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, ((total - pomoRemaining.value) / total) * 100))
})
const pomoPhaseText = computed(() => phaseLabel(pomoState.value.phase))
const pomoActionLabel = computed(() =>
  pomoRunning.value ? '暂停' : pomoAwaiting.value ? '开始下一阶段' : '开始'
)

watch([pomoFocusMin, pomoShortMin, pomoLongMin], () => {
  if (pomoRunning.value) return
  pomoRemainMs.value = pomoPhaseMs.value
})

watch(pomoRemaining, (value) => {
  if (!pomoRunning.value || value > 0) return
  pomoRunning.value = false
  pomoState.value = nextPhase(pomoState.value)
  pomoRemainMs.value = pomoPhaseMs.value
  pomoAwaiting.value = true
  stopTickerIfIdle()
  notifyAlarm()
})

function pomoStart(): void {
  if (pomoRunning.value) return
  if (pomoRemainMs.value <= 0) pomoRemainMs.value = pomoPhaseMs.value
  if (pomoRemainMs.value <= 0) return
  pomoEndAt.value = performance.now() + pomoRemainMs.value
  pomoRunning.value = true
  pomoAwaiting.value = false
  startTicker()
}

function pomoPause(): void {
  if (!pomoRunning.value) return
  pomoRemainMs.value = pomoRemaining.value
  pomoRunning.value = false
  stopTickerIfIdle()
}

function pomoSkip(): void {
  pomoRunning.value = false
  pomoState.value = nextPhase(pomoState.value)
  pomoRemainMs.value = pomoPhaseMs.value
  pomoAwaiting.value = true
  stopTickerIfIdle()
}

function pomoReset(): void {
  pomoRunning.value = false
  pomoState.value = { phase: 'focus', completedFocus: 0 }
  pomoRemainMs.value = pomoPhaseMs.value
  pomoAwaiting.value = false
  stopTickerIfIdle()
}

function pomoPresetDefault(): void {
  pomoFocusMin.value = 25
  pomoShortMin.value = 5
  pomoLongMin.value = 15
}

/* ---------- 模式切换 ---------- */

const timerRunning = computed(() => swRunning.value || cdRunning.value || pomoRunning.value)

function resetAllTimers(): void {
  swRunning.value = false
  swAccumulated.value = 0
  swStartedAt.value = 0
  swLaps.value = []
  cdRunning.value = false
  cdFinished.value = false
  cdRemainMs.value = cdTotalMs.value
  pomoRunning.value = false
  pomoAwaiting.value = false
  pomoState.value = { phase: 'focus', completedFocus: 0 }
  pomoRemainMs.value = pomoPhaseMs.value
  clearTitleFlag()
  stopTicker()
}

function applyMode(next: TimerMode): void {
  resetAllTimers()
  timerMode.value = next
}

function onModeChange(value: string | number): void {
  if (value !== 'stopwatch' && value !== 'countdown' && value !== 'pomodoro') return
  if (value === timerMode.value) return
  if (timerRunning.value) {
    pendingMode.value = value
    return
  }
  applyMode(value)
}

function confirmModeSwitch(): void {
  const next = pendingMode.value
  pendingMode.value = null
  if (next !== null) applyMode(next)
}

function cancelModeSwitch(): void {
  pendingMode.value = null
}

onUnmounted(() => {
  stopTicker()
  clearTitleFlag()
  if (audioContext !== undefined) {
    void audioContext.close()
  }
})
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">实用工具</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        子网 / IP 计算器与秒表、倒计时、番茄钟（全部本地运行，不联网）
      </p>
    </div>

    <!-- 页签仅作切换器，内容用 v-if 渲染；标签必须走 #tab 插槽（与 text-toolbox 同范式） -->
    <NTabs v-model:value="activeTab" type="line">
      <NTabPane name="ip">
        <template #tab>子网 / IP</template>
      </NTabPane>
      <NTabPane name="timer">
        <template #tab>计时器</template>
      </NTabPane>
    </NTabs>

    <!-- 页签一：子网 / IP -->
    <div v-if="activeTab === 'ip'" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-end gap-2">
        <div class="flex min-w-64 flex-1 flex-col gap-1">
          <NText depth="2" class="text-sm">CIDR</NText>
          <NInput
            v-model:value="cidrInput"
            placeholder="输入 CIDR，如 192.168.1.0/24"
            aria-label="CIDR 输入"
            @keyup.enter="runSubnet"
          />
        </div>
        <NButton type="primary" @click="runSubnet">计算</NButton>
        <NButton quaternary @click="resetSubnet">清空</NButton>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <NText depth="3" class="text-xs">预设</NText>
        <NButton
          v-for="preset in CIDR_PRESETS"
          :key="preset"
          size="tiny"
          quaternary
          @click="applyPreset(preset)"
        >
          {{ preset }}
        </NButton>
      </div>

      <div v-if="subnetError !== null" role="alert" class="flex flex-col gap-1">
        <NText type="error" class="text-sm">
          {{ errorMessage(subnetError.code) }}（{{ subnetError.code }}）
        </NText>
        <NText v-if="subnetError.detail !== undefined" depth="3" class="text-xs">
          {{ subnetError.detail }}
        </NText>
      </div>

      <template v-if="subnet !== null">
        <NText v-if="subnet.normalized" depth="3" class="text-xs">
          已按掩码归一化网络地址（输入地址 {{ subnet.address }}）
        </NText>
        <div class="grid gap-2 sm:grid-cols-2">
          <div
            v-for="row in subnetRows"
            :key="row.key"
            class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
          >
            <NText depth="2" class="w-24 shrink-0 text-xs">{{ row.label }}</NText>
            <NText class="flex-1 break-all font-mono text-sm">{{ row.value }}</NText>
          </div>
        </div>
      </template>

      <NText v-else-if="subnetError === null" depth="3" class="text-sm">
        输入 CIDR（如 192.168.1.0/24）后点击「计算」或按回车；也支持 192.168.1.10/255.255.255.0
        的掩码写法。
      </NText>
    </div>

    <!-- 页签二：计时器 -->
    <div v-if="activeTab === 'timer'" class="flex flex-col gap-3">
      <NRadioGroup :value="timerMode" @update:value="onModeChange">
        <NRadioButton value="stopwatch">秒表</NRadioButton>
        <NRadioButton value="countdown">倒计时</NRadioButton>
        <NRadioButton value="pomodoro">番茄钟</NRadioButton>
      </NRadioGroup>

      <NAlert v-if="pendingMode !== null" type="warning" :bordered="false">
        <div class="flex flex-wrap items-center gap-2">
          <span>计时进行中，切换模式会重置当前计时。</span>
          <NButton size="tiny" type="primary" @click="confirmModeSwitch">确认切换</NButton>
          <NButton size="tiny" quaternary @click="cancelModeSwitch">取消</NButton>
        </div>
      </NAlert>

      <div v-if="timerMode === 'stopwatch'" class="flex flex-col gap-3">
        <NText data-testid="stopwatch-display" class="font-mono text-4xl tabular-nums">
          {{ swDisplay }}
        </NText>
        <div class="flex flex-wrap items-center gap-2">
          <NButton v-if="!swRunning" type="primary" @click="swStart">
            <Play class="mr-1 h-4 w-4" />开始
          </NButton>
          <NButton v-else @click="swPause"> <Pause class="mr-1 h-4 w-4" />暂停 </NButton>
          <NButton :disabled="!swRunning" @click="swLap">
            <Flag class="mr-1 h-4 w-4" />计次
          </NButton>
          <NButton quaternary @click="swReset"> <RotateCcw class="mr-1 h-4 w-4" />重置 </NButton>
        </div>

        <div v-if="swLaps.length > 0" class="flex flex-col gap-1">
          <NText depth="2" class="text-sm font-medium">
            计次（{{ swLaps.length }} / {{ MAX_LAPS }}）
          </NText>
          <div class="flex max-h-64 flex-col gap-1 overflow-y-auto">
            <div
              v-for="(lap, index) in swLaps"
              :key="`${lap.totalMs}-${index}`"
              class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-1.5"
            >
              <NTag size="tiny" :bordered="false">#{{ swLaps.length - index }}</NTag>
              <NText depth="2" class="text-xs">分段 {{ formatClock(lap.segmentMs) }}</NText>
              <NText class="font-mono text-xs">累计 {{ formatClock(lap.totalMs) }}</NText>
            </div>
          </div>
        </div>
        <NText v-else depth="3" class="text-sm">
          从 00:00.00 起步；运行中可随时「计次」，最多保留 {{ MAX_LAPS }} 条。
        </NText>
      </div>

      <div v-else-if="timerMode === 'countdown'" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-1">
            <NText depth="2" class="text-sm">时</NText>
            <NInputNumber v-model:value="cdHours" :min="0" :max="99" class="w-20" />
          </div>
          <div class="flex flex-col gap-1">
            <NText depth="2" class="text-sm">分</NText>
            <NInputNumber v-model:value="cdMinutes" :min="0" :max="59" class="w-20" />
          </div>
          <div class="flex flex-col gap-1">
            <NText depth="2" class="text-sm">秒</NText>
            <NInputNumber v-model:value="cdSeconds" :min="0" :max="59" class="w-20" />
          </div>
        </div>

        <NText data-testid="countdown-display" class="font-mono text-4xl tabular-nums">
          {{ cdDisplay }}
        </NText>

        <div class="flex flex-wrap items-center gap-2">
          <NButton v-if="!cdRunning" type="primary" @click="cdStart">
            <Play class="mr-1 h-4 w-4" />开始
          </NButton>
          <NButton v-else @click="cdPause"> <Pause class="mr-1 h-4 w-4" />暂停 </NButton>
          <NButton quaternary @click="cdReset"> <RotateCcw class="mr-1 h-4 w-4" />重置 </NButton>
        </div>

        <NAlert v-if="cdFinished" type="success" title="时间到">
          倒计时已结束，可「重置」后重新开始。
        </NAlert>
      </div>

      <div v-else class="flex flex-col gap-3">
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-1">
            <NText depth="2" class="text-sm">专注（分钟）</NText>
            <NInputNumber v-model:value="pomoFocusMin" :min="1" :max="99" class="w-20" />
          </div>
          <div class="flex flex-col gap-1">
            <NText depth="2" class="text-sm">短休（分钟）</NText>
            <NInputNumber v-model:value="pomoShortMin" :min="1" :max="99" class="w-20" />
          </div>
          <div class="flex flex-col gap-1">
            <NText depth="2" class="text-sm">长休（分钟）</NText>
            <NInputNumber v-model:value="pomoLongMin" :min="1" :max="99" class="w-20" />
          </div>
          <NButton size="tiny" quaternary @click="pomoPresetDefault">默认 25 / 5 / 15</NButton>
        </div>

        <div class="flex flex-wrap items-center gap-4">
          <NProgress type="circle" :percentage="pomoPercent" :stroke-width="8" class="w-32">
            <div class="flex flex-col items-center">
              <NText data-testid="pomodoro-remaining" class="font-mono text-lg tabular-nums">
                {{ pomoDisplay }}
              </NText>
              <NText depth="3" class="text-xs">{{ pomoPhaseText }}</NText>
            </div>
          </NProgress>
          <div class="flex flex-col gap-1">
            <NText class="text-sm">当前阶段：{{ pomoPhaseText }}</NText>
            <NText depth="2" class="text-sm">
              已完成专注 {{ pomoState.completedFocus }} 个（本轮第
              {{ (pomoState.completedFocus % 4) + 1 }} 个）
            </NText>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <NButton v-if="!pomoRunning" type="primary" @click="pomoStart">
            <Play class="mr-1 h-4 w-4" />{{ pomoActionLabel }}
          </NButton>
          <NButton v-else @click="pomoPause"> <Pause class="mr-1 h-4 w-4" />暂停 </NButton>
          <NButton @click="pomoSkip"> <SkipForward class="mr-1 h-4 w-4" />跳过 </NButton>
          <NButton quaternary @click="pomoReset"> <RotateCcw class="mr-1 h-4 w-4" />重置 </NButton>
        </div>

        <NText depth="3" class="text-xs">
          专注 4 个后进入长休；阶段结束后需点「开始下一阶段」，不会自动计时。
        </NText>
      </div>
    </div>
  </div>
</template>
