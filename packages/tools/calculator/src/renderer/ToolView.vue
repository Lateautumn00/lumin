<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { NButton, NIcon, NInput, NPopconfirm } from 'naive-ui'
import { Delete, type LucideIcon } from '@lucide/vue'
import { formatNumber } from '@lumin/shared'

import { evaluate, type AngleMode } from '../calc/evaluate'
import { useHistoryStore, type HistoryEntry } from '../calc/history'

type Layout = 'basic' | 'scientific'

interface PadKey {
  label: string
  insert?: string
  action?: 'clear' | 'backspace' | 'equals'
  icon?: LucideIcon
}

const BASIC_KEYS: readonly PadKey[] = [
  { label: 'C', action: 'clear' },
  { label: '', action: 'backspace', icon: Delete },
  { label: '(', insert: '(' },
  { label: ')', insert: ')' },
  { label: '7', insert: '7' },
  { label: '8', insert: '8' },
  { label: '9', insert: '9' },
  { label: '÷', insert: '/' },
  { label: '4', insert: '4' },
  { label: '5', insert: '5' },
  { label: '6', insert: '6' },
  { label: '×', insert: '*' },
  { label: '1', insert: '1' },
  { label: '2', insert: '2' },
  { label: '3', insert: '3' },
  { label: '−', insert: '-' },
  { label: '0', insert: '0' },
  { label: '.', insert: '.' },
  { label: '%', insert: '%' },
  { label: '+', insert: '+' },
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
  { label: 'π', insert: 'pi' },
  { label: 'e', insert: 'e' }
]

const INSERTABLE_RE = /^[0-9a-zA-Z+\-*/^().% ]$/

const layout = ref<Layout>('scientific')
const angleMode = ref<AngleMode>('deg')
const expr = ref('')
const result = ref<string | null>(null)
const error = ref<{ code: string; message: string } | null>(null)
const store = useHistoryStore()
const inputRef = ref<InstanceType<typeof NInput> | null>(null)

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
})
</script>

<template>
  <div class="flex h-full min-h-0 gap-4">
    <div class="flex min-w-0 flex-1 flex-col gap-3">
      <div class="flex items-center gap-2">
        <h1 class="text-base font-semibold">计算器</h1>
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

      <div v-if="layout === 'scientific'" class="grid grid-cols-4 gap-1.5">
        <NButton v-for="key in SCIENTIFIC_KEYS" :key="key.label" @click="onPad(key)">
          {{ key.label }}
        </NButton>
      </div>

      <div class="grid grid-cols-4 gap-1.5">
        <NButton
          v-for="key in BASIC_KEYS"
          :key="key.label || key.action"
          :type="key.action === 'equals' ? 'primary' : 'default'"
          @click="onPad(key)"
        >
          <NIcon v-if="key.icon" :component="key.icon" :size="14" aria-label="退格" />
          <template v-else>{{ key.label }}</template>
        </NButton>
      </div>
    </div>

    <aside class="flex w-56 shrink-0 flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium">历史</span>
        <NPopconfirm @positive-click="store.clear()">
          <template #trigger>
            <NButton size="tiny" quaternary :disabled="store.entries.length === 0">清空</NButton>
          </template>
          清空全部历史记录？
        </NPopconfirm>
      </div>

      <p v-if="store.entries.length === 0" class="text-sm text-[var(--lumin-color-text-secondary)]">
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
</template>
