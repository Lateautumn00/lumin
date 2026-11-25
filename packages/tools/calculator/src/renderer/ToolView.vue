<script setup lang="ts">
/**
 * @file ToolView.vue 计算器主视图（计算 / 进制 / 单位换算 / 生活计算 四页签）
 * @author cuilanchao
 * @date 2026-11-25
 * @description M79 由独立工具 unit-converter（单位换算）与 life-calculator（生活计算）并入，
 *              计算与进制为计算器原有能力；四页签扁平排列，仅计算页签挂全局键盘输入监听。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NButton, NIcon, NInput, NPopconfirm, NSelect, NTabPane, NTabs } from 'naive-ui'
import { Copy, Delete, type LucideIcon } from '@lucide/vue'
import { formatNumber } from '@lumin/shared'

import { evaluate, type AngleMode } from '../calc/evaluate'
import { convertBase, type Radix } from '../calc/base'
import { useHistoryStore, type HistoryEntry } from '../calc/history'
import UnitTab from './UnitTab.vue'
import LifeTab from './LifeTab.vue'

type Layout = 'basic' | 'scientific'

/** 页签键 */
type TabKey = 'calc' | 'base' | 'units' | 'life'

interface PadKey {
  label: string
  insert?: string
  action?: 'clear' | 'backspace' | 'equals'
  icon?: LucideIcon
}

const BASIC_KEYS: readonly PadKey[] = [
  { label: 'C', action: 'clear' },
  { label: '', action: 'backspace', icon: Delete },
  { label: '%', insert: '%' },
  { label: '÷', insert: '/' },
  { label: '7', insert: '7' },
  { label: '8', insert: '8' },
  { label: '9', insert: '9' },
  { label: '×', insert: '*' },
  { label: '4', insert: '4' },
  { label: '5', insert: '5' },
  { label: '6', insert: '6' },
  { label: '−', insert: '-' },
  { label: '1', insert: '1' },
  { label: '2', insert: '2' },
  { label: '3', insert: '3' },
  { label: '+', insert: '+' },
  { label: '0', insert: '0' },
  { label: '.', insert: '.' },
  { label: '=', action: 'equals' }
]

const SCIENTIFIC_KEYS: readonly PadKey[] = [
  { label: 'sin', insert: 'sin(' },
  { label: 'cos', insert: 'cos(' },
  { label: 'tan', insert: 'tan(' },
  { label: 'ln', insert: 'ln(' },
  { label: 'log', insert: 'log(' },
  { label: '√', insert: 'sqrt(' },
  { label: 'x^y', insert: '^' },
  { label: 'n!', insert: '!' },
  { label: 'π', insert: 'pi' },
  { label: 'e', insert: 'e' },
  { label: '(', insert: '(' },
  { label: ')', insert: ')' }
]

const INSERTABLE_RE = /^[0-9a-zA-Z+\-*/^().%! ]$/

const activeTab = ref<TabKey>('calc')

const layout = ref<Layout>('scientific')
const angleMode = ref<AngleMode>('deg')
const expr = ref('')
const result = ref<string | null>(null)
const error = ref<{ code: string; message: string } | null>(null)
const store = useHistoryStore()
const inputRef = ref<InstanceType<typeof NInput> | null>(null)

/* ---------- 进制换算 ---------- */

const RADIX_OPTIONS: { label: string; value: Radix }[] = [
  { label: '二进制 (2)', value: 2 },
  { label: '八进制 (8)', value: 8 },
  { label: '十进制 (10)', value: 10 },
  { label: '十六进制 (16)', value: 16 }
]

interface BaseRow {
  key: string
  label: string
  value: string
}

const baseInput = ref('')
const baseRadix = ref<Radix>(10)
const copiedBase = ref('')
const copyError = ref('')
let copiedBaseTimer: ReturnType<typeof setTimeout> | undefined

const baseState = computed<{ rows: BaseRow[]; error: string }>(() => {
  if (baseInput.value.trim() === '') return { rows: [], error: '' }
  const result = convertBase(baseInput.value, baseRadix.value)
  if (!result.ok) return { rows: [], error: result.error.message }
  return {
    rows: [
      { key: 'decimal', label: '十进制', value: result.value.decimal },
      { key: 'binary', label: '二进制', value: result.value.binary },
      { key: 'octal', label: '八进制', value: result.value.octal },
      { key: 'hex', label: '十六进制', value: result.value.hex }
    ],
    error: ''
  }
})

function onRadixChange(value: string | number): void {
  const numeric = Number(value)
  if (numeric === 2 || numeric === 8 || numeric === 10 || numeric === 16) baseRadix.value = numeric
}

async function copyBase(text: string, key: string): Promise<void> {
  copyError.value = ''
  try {
    await navigator.clipboard.writeText(text)
    copiedBase.value = key
    if (copiedBaseTimer !== undefined) clearTimeout(copiedBaseTimer)
    copiedBaseTimer = setTimeout(() => {
      if (copiedBase.value === key) copiedBase.value = ''
    }, 1200)
  } catch {
    copyError.value = '复制失败，请手动选择文本复制'
  }
}

/* ---------- 计算器 ---------- */

function resetFeedback(): void {
  result.value = null
  error.value = null
}

function insert(text: string): void {
  expr.value += text
  resetFeedback()
}

function backspace(): void {
  expr.value = expr.value.slice(0, -1)
  resetFeedback()
}

function clearExpr(): void {
  expr.value = ''
  resetFeedback()
}

function compute(): void {
  const res = evaluate(expr.value, angleMode.value)
  if (!res.ok) {
    result.value = null
    error.value = { code: res.error.code, message: res.error.message }
    return
  }
  error.value = null
  result.value = formatNumber(res.value)
  store.add(expr.value, result.value)
}

function onPad(key: PadKey): void {
  if (key.action === 'clear') {
    clearExpr()
  } else if (key.action === 'backspace') {
    backspace()
  } else if (key.action === 'equals') {
    compute()
  } else if (key.insert !== undefined) {
    insert(key.insert)
  }
  inputRef.value?.focus()
}

function fillFrom(entry: HistoryEntry): void {
  expr.value = entry.expr
  resetFeedback()
  inputRef.value?.focus()
}

function toggleAngle(): void {
  angleMode.value = angleMode.value === 'deg' ? 'rad' : 'deg'
}

function onInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    compute()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    clearExpr()
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (activeTab.value !== 'calc') return
  if (isEditable(event.target)) return
  if (event.target instanceof HTMLElement && event.target.tagName === 'BUTTON') {
    if (event.key === 'Enter' || event.key === ' ') return
  }
  if (event.key === 'Enter' || event.key === '=') {
    event.preventDefault()
    compute()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    clearExpr()
    return
  }
  if (event.key === 'Backspace') {
    event.preventDefault()
    backspace()
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (INSERTABLE_RE.test(event.key)) {
    event.preventDefault()
    insert(event.key)
  }
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
  inputRef.value?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  if (copiedBaseTimer !== undefined) clearTimeout(copiedBaseTimer)
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <div>
      <h1 class="text-base font-semibold">计算器</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        表达式求值与进制换算、17 类单位互转、房贷/个税/百分比折扣；全部本地计算，不联网、不存储。
      </p>
    </div>

    <NTabs v-model:value="activeTab" type="line">
      <NTabPane name="calc">
        <template #tab>计算</template>
      </NTabPane>
      <NTabPane name="base">
        <template #tab>进制</template>
      </NTabPane>
      <NTabPane name="units">
        <template #tab>单位换算</template>
      </NTabPane>
      <NTabPane name="life">
        <template #tab>生活计算</template>
      </NTabPane>
    </NTabs>

    <div v-if="activeTab === 'calc'" class="flex min-h-0 flex-1 gap-4">
      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <div class="flex items-center gap-2">
          <div class="ml-auto flex items-center gap-1">
            <NButton
              size="small"
              :type="layout === 'basic' ? 'primary' : 'default'"
              @click="layout = 'basic'"
            >
              基础
            </NButton>
            <NButton
              size="small"
              :type="layout === 'scientific' ? 'primary' : 'default'"
              @click="layout = 'scientific'"
            >
              科学
            </NButton>
            <NButton v-if="layout === 'scientific'" size="small" @click="toggleAngle">
              {{ angleMode === 'deg' ? 'DEG' : 'RAD' }}
            </NButton>
          </div>
        </div>

        <div
          class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-3"
        >
          <NInput
            ref="inputRef"
            v-model:value="expr"
            placeholder="输入表达式，Enter 计算"
            @keydown="onInputKeydown"
            @update:value="resetFeedback"
          />
          <div class="flex min-h-6 items-center justify-end gap-2">
            <span v-if="error" class="text-sm text-[var(--lumin-color-danger)]">
              {{ error.message }}
            </span>
            <span
              v-else-if="result !== null"
              class="text-lg font-semibold tabular-nums text-[var(--lumin-color-text)]"
            >
              = {{ result }}
            </span>
          </div>
        </div>

        <div v-if="layout === 'scientific'" class="grid grid-cols-6 gap-2">
          <NButton
            v-for="key in SCIENTIFIC_KEYS"
            :key="key.label"
            tertiary
            class="h-10!"
            @click="onPad(key)"
          >
            {{ key.label }}
          </NButton>
        </div>

        <div class="grid grid-cols-4 gap-2">
          <NButton
            v-for="key in BASIC_KEYS"
            :key="key.label || key.action"
            :type="key.action === 'equals' ? 'primary' : 'default'"
            :secondary="['÷', '×', '−', '+'].includes(key.label)"
            :class="['h-10!', key.label === '0' ? 'col-span-2' : '']"
            @click="onPad(key)"
          >
            <NIcon v-if="key.icon" :component="key.icon" :size="14" aria-label="退格" />
            <template v-else>{{ key.label }}</template>
          </NButton>
        </div>
      </div>

      <aside class="hidden w-56 shrink-0 flex-col gap-2 min-[720px]:flex">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">历史</span>
          <NPopconfirm @positive-click="store.clear()">
            <template #trigger>
              <NButton size="tiny" quaternary :disabled="store.entries.length === 0">清空</NButton>
            </template>
            清空全部历史记录？
          </NPopconfirm>
        </div>

        <p
          v-if="store.entries.length === 0"
          class="text-sm text-[var(--lumin-color-text-secondary)]"
        >
          暂无历史记录
        </p>

        <div v-else class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          <button
            v-for="entry in store.entries"
            :key="`${entry.at}-${entry.expr}`"
            type="button"
            class="flex cursor-pointer flex-col gap-0.5 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] px-2 py-1.5 text-left hover:border-[var(--lumin-color-primary)]"
            @click="fillFrom(entry)"
          >
            <span class="truncate text-xs text-[var(--lumin-color-text-secondary)]">
              {{ entry.expr }}
            </span>
            <span class="truncate text-sm font-medium tabular-nums">= {{ entry.result }}</span>
            <span class="text-[10px] text-[var(--lumin-color-text-secondary)]">
              {{ new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false }) }}
            </span>
          </button>
        </div>
      </aside>
    </div>

    <div v-else-if="activeTab === 'base'" class="flex max-w-3xl flex-col gap-3">
      <div>
        <h2 class="text-sm font-semibold">进制换算</h2>
        <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
          2 / 8 / 10 / 16 进制整数互转，使用 BigInt 解析，大整数不丢精度
        </p>
      </div>

      <div class="flex flex-wrap items-end gap-3">
        <div class="flex min-w-64 flex-1 flex-col gap-1">
          <span class="text-sm text-[var(--lumin-color-text-secondary)]">数值</span>
          <NInput
            v-model:value="baseInput"
            placeholder="输入整数，如 255"
            aria-label="进制输入值"
          />
        </div>
        <div class="flex w-40 flex-col gap-1">
          <span class="text-sm text-[var(--lumin-color-text-secondary)]">输入进制</span>
          <NSelect
            :value="baseRadix"
            :options="RADIX_OPTIONS"
            aria-label="输入进制"
            @update:value="onRadixChange"
          />
        </div>
      </div>

      <div
        v-if="baseState.error !== ''"
        role="alert"
        class="text-sm text-[var(--lumin-color-danger)]"
      >
        {{ baseState.error }}
      </div>

      <div v-if="baseState.rows.length > 0" class="flex flex-col gap-1">
        <div
          v-for="row in baseState.rows"
          :key="row.key"
          class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] px-3 py-2"
        >
          <span class="w-20 shrink-0 text-xs text-[var(--lumin-color-text-secondary)]">
            {{ row.label }}
          </span>
          <span class="flex-1 break-all font-mono text-sm">{{ row.value }}</span>
          <NButton size="tiny" quaternary @click="copyBase(row.value, row.key)">
            <NIcon :component="Copy" :size="12" />
            {{ copiedBase === row.key ? '已复制' : '复制' }}
          </NButton>
        </div>
      </div>
      <p
        v-else-if="baseState.error === ''"
        class="text-sm text-[var(--lumin-color-text-secondary)]"
      >
        输入整数后实时显示十进制、二进制、八进制与十六进制结果。
      </p>

      <div v-if="copyError !== ''" role="alert" class="text-sm text-[var(--lumin-color-danger)]">
        {{ copyError }}
      </div>

      <p class="text-xs text-[var(--lumin-color-text-secondary)]">
        仅支持整数（可带正负号），十进制 512 字符以内；十六进制输入不区分大小写，输出为小写。
      </p>
    </div>

    <UnitTab v-else-if="activeTab === 'units'" />
    <LifeTab v-else />
  </div>
</template>
