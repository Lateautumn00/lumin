<!--
剪贴板历史（M59）
  作者：cuilanchao · 修改时间：2026-11-23
  三态强制：空态引导复制 / 加载态首载 NSpin / 报错态 CH_STORAGE_FAILED 文案 + 重试按钮。
  页内轮询（仅挂载期间，卸载即停）：1s 调 poll，超限内容一次性提示不入库。
  搜索过滤（≤64 字符、子串忽略大小写）、复制回写并本地前移、置顶/删除/清空二次确认。
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NAlert, NButton, NEmpty, NInput, NPopconfirm, NSpin, NText } from 'naive-ui'
import { Check, Copy, Pin, Trash2 } from '@lucide/vue'
import { toStructuredError, type StructuredError } from '@lumin/shared'
import {
  filterEntries,
  formatRelativeTime,
  formatTextStats,
  moveToFront,
  removeEntry,
  summarize,
  togglePinned,
  upsertEntry
} from '../entries'
import { isRetryable } from '../errors'
import { MAX_QUERY_LENGTH, type Entry } from '../schema'
import { clearHistory, deleteEntry, loadList, loadPoll, togglePin } from './client'

const items = ref<Entry[]>([])
const loading = ref(true)
const error = ref<StructuredError | null>(null)
const query = ref('')
const tooLarge = ref(false)
const copiedId = ref<string | null>(null)
const copyError = ref('')
const now = ref(Date.now())

let pollTimer: ReturnType<typeof setInterval> | undefined
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const filtered = computed(() => filterEntries(items.value, query.value))
const summary = computed(() => summarize(filtered.value))

/** 首载全量（挂载与报错重试共用） */
async function load(): Promise<void> {
  loading.value = true
  try {
    const result = await loadList()
    items.value = result.items
    error.value = null
    now.value = Date.now()
  } catch (err) {
    error.value = toStructuredError(err)
  } finally {
    loading.value = false
  }
}

/** 单次轮询：新条目前移、超限一次性提示、成功即清除存储错误 */
async function pollOnce(): Promise<void> {
  now.value = Date.now()
  try {
    const result = await loadPoll()
    error.value = null
    if (result.skipped === 'TOO_LARGE') {
      tooLarge.value = true
      return
    }
    tooLarge.value = false
    if (result.entry !== null) items.value = upsertEntry(items.value, result.entry)
  } catch (err) {
    error.value = toStructuredError(err)
  }
}

/** 复制：回写系统剪贴板并把该条本地前移（置顶序保持） */
async function onCopy(item: Entry): Promise<void> {
  copyError.value = ''
  try {
    await navigator.clipboard.writeText(item.text)
  } catch {
    copyError.value = '复制失败（剪贴板不可用）'
    return
  }
  const moved = moveToFront(items.value, item.id, Date.now())
  if (moved !== null) items.value = moved
  copiedId.value = item.id
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    if (copiedId.value === item.id) copiedId.value = null
    copiedTimer = undefined
  }, 1500)
}

/** 置顶 / 取消置顶（服务端为准，成功后本地同步） */
async function onTogglePin(item: Entry): Promise<void> {
  try {
    await togglePin(item.id)
    const next = togglePinned(items.value, item.id)
    if (next !== null) items.value = next
    error.value = null
  } catch (err) {
    error.value = toStructuredError(err)
  }
}

/** 删除单条 */
async function onDelete(item: Entry): Promise<void> {
  try {
    await deleteEntry(item.id)
    const next = removeEntry(items.value, item.id)
    if (next !== null) items.value = next
    error.value = null
  } catch (err) {
    error.value = toStructuredError(err)
  }
}

/** 清空全部历史（NPopconfirm 二次确认回调） */
async function onClear(): Promise<void> {
  try {
    await clearHistory()
    items.value = []
    error.value = null
  } catch (err) {
    error.value = toStructuredError(err)
  }
}

onMounted(() => {
  void (async () => {
    await load()
    pollTimer = setInterval(() => {
      void pollOnce()
    }, 1000)
  })()
})

onUnmounted(() => {
  if (pollTimer !== undefined) clearInterval(pollTimer)
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <header>
      <h1 class="text-base font-semibold">剪贴板历史</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        自动记录本工具页打开期间复制的文本，纯本地保存，不会上传
      </p>
    </header>

    <!-- 顶栏：搜索 + 条数徽标（随过滤更新） + 清空二次确认 -->
    <div class="flex flex-wrap items-center gap-2">
      <NInput
        v-model:value="query"
        clearable
        :maxlength="MAX_QUERY_LENGTH"
        placeholder="搜索剪贴板内容"
        class="w-64"
      />
      <NText depth="3" class="text-xs tabular-nums">{{ summary }}</NText>
      <NPopconfirm positive-text="确认" @positive-click="onClear">
        <template #trigger>
          <NButton size="small" type="error" quaternary class="ml-auto">清空</NButton>
        </template>
        清空全部历史（含置顶）？
      </NPopconfirm>
    </div>

    <!-- >100KB 一次性提示（不入库） -->
    <NAlert v-if="tooLarge" type="warning" closable role="alert" @close="tooLarge = false">
      剪贴板内容过大（>100KB），已跳过
    </NAlert>

    <!-- 报错态：结构化错误码 → 中文文案 + 重试（重新 list） -->
    <NAlert v-if="error !== null" type="error" role="alert" :title="error.message">
      <div class="flex flex-wrap items-center gap-3">
        <NText depth="3" class="text-xs">{{ error.code }}</NText>
        <NText v-if="error.detail !== undefined" depth="3" class="text-xs">
          {{ error.detail }}
        </NText>
        <NButton v-if="isRetryable(error.code)" size="tiny" @click="load">重试</NButton>
      </div>
    </NAlert>

    <!-- 加载态 -->
    <div
      v-if="loading"
      class="flex min-h-40 flex-1 items-center justify-center gap-2"
      role="status"
    >
      <NSpin :size="18" />
      <NText depth="3" class="text-sm">正在加载剪贴板历史…</NText>
    </div>

    <!-- 空态 / 搜索无命中 -->
    <div v-else-if="filtered.length === 0" class="flex min-h-40 flex-1 items-center justify-center">
      <NEmpty
        :description="items.length === 0 ? '复制任意文本后自动出现在这里' : '没有匹配的条目'"
        class="py-8"
      />
    </div>

    <!-- 条目列表：置顶在前、组内新到旧（服务端排序，本地同规则重排） -->
    <ul
      v-else
      class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1"
      aria-label="历史条目列表"
    >
      <li
        v-for="item in filtered"
        :key="item.id"
        class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-3"
      >
        <div class="flex items-start justify-between gap-3">
          <p class="min-w-0 flex-1 font-mono text-sm break-all whitespace-pre-wrap line-clamp-3">
            {{ item.text }}
          </p>
          <div class="flex shrink-0 items-center gap-1">
            <NButton size="tiny" quaternary @click="onCopy(item)">
              <template #icon>
                <Check
                  v-if="copiedId === item.id"
                  class="h-3.5 w-3.5 text-[var(--lumin-color-success)]"
                />
                <Copy v-else class="h-3.5 w-3.5" />
              </template>
              {{ copiedId === item.id ? '已复制' : '复制' }}
            </NButton>
            <NButton size="tiny" quaternary @click="onTogglePin(item)">
              <template #icon><Pin class="h-3.5 w-3.5" /></template>
              {{ item.pinned ? '取消置顶' : '置顶' }}
            </NButton>
            <NButton size="tiny" quaternary @click="onDelete(item)">
              <template #icon><Trash2 class="h-3.5 w-3.5" /></template>
              删除
            </NButton>
          </div>
        </div>
        <div
          class="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--lumin-color-text-secondary)]"
        >
          <span v-if="item.pinned" class="inline-flex items-center gap-1">
            <Pin class="h-3 w-3" />已置顶
          </span>
          <span>{{ formatTextStats(item.text) }}</span>
          <span class="tabular-nums">{{ formatRelativeTime(item.createdAt, now) }}</span>
        </div>
      </li>
    </ul>

    <!-- 复制失败（剪贴板不可用） -->
    <NText v-if="copyError !== ''" type="error" class="text-xs">{{ copyError }}</NText>
  </div>
</template>
