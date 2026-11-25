<!--
剪贴板历史（M59 文本 / M61 图片扩展）
  作者：cuilanchao · 修改时间：2026-11-24
  三态强制：空态引导复制 / 加载态首载 NSpin / 报错态 CH_STORAGE_FAILED·CH_IMAGE_MISSING 文案 + 重试按钮。
  页内轮询（仅挂载期间，卸载即停）：1s 调 poll（图片优先判定），超限内容一次性提示不入库。
  类型分段筛选（全部/文本/图片）与搜索叠加；搜索词非空时图片不参与搜索。
  文本复制走渲染端 clipboard API，图片复制走 copy 通道（主进程 clipboard.write + ClipboardItem）；
  点缩略图开预览 Modal，打开时才调 image 通道取原图，失败 → CH_IMAGE_MISSING + 重试。
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NEmpty,
  NInput,
  NModal,
  NPopconfirm,
  NRadioButton,
  NRadioGroup,
  NSpin,
  NText
} from 'naive-ui'
import { Check, Copy, Image as ImageIcon, Pin, Trash2 } from '@lucide/vue'
import { toStructuredError, type StructuredError } from '@lumin/shared'
import {
  filterEntries,
  formatImageStats,
  formatRelativeTime,
  formatTextStats,
  moveToFront,
  removeEntry,
  summarize,
  togglePinned,
  upsertEntry,
  type EntryTypeFilter
} from '../entries'
import { isRetryable } from '../errors'
import { MAX_QUERY_LENGTH, type Entry } from '../schema'
import {
  clearHistory,
  copyImage,
  deleteEntry,
  loadImage,
  loadList,
  loadPoll,
  togglePin
} from './client'

const items = ref<Entry[]>([])
const loading = ref(true)
const error = ref<StructuredError | null>(null)
const query = ref('')
const typeFilter = ref<EntryTypeFilter>('all')
const tooLarge = ref(false)
const copiedId = ref<string | null>(null)
const copyError = ref('')
const now = ref(Date.now())

// 图片预览 Modal（打开时才按需取原图）
const previewShow = ref(false)
const previewItem = ref<Entry | null>(null)
const previewDataUrl = ref('')
const previewLoading = ref(false)
const previewError = ref<StructuredError | null>(null)

let pollTimer: ReturnType<typeof setInterval> | undefined
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const filtered = computed(() => filterEntries(items.value, query.value, typeFilter.value))
const summary = computed(() => summarize(filtered.value))

/** 类型分段筛选切换（NRadioGroup 回包 string|number，收窄到筛选联合类型） */
function onTypeFilterChange(value: string | number): void {
  if (value === 'all' || value === 'text' || value === 'image') typeFilter.value = value
}

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

/** 复制成功后的本地前移 + 「已复制」1.5s 按钮态（文本/图片共用） */
function markCopied(item: Entry): void {
  const moved = moveToFront(items.value, item.id, Date.now())
  if (moved !== null) items.value = moved
  copiedId.value = item.id
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    if (copiedId.value === item.id) copiedId.value = null
    copiedTimer = undefined
  }, 1500)
}

/** 文本复制：渲染端回写系统剪贴板并本地前移（置顶序保持） */
async function onCopy(item: Entry): Promise<void> {
  copyError.value = ''
  try {
    await navigator.clipboard.writeText(item.text)
  } catch {
    copyError.value = '复制失败（剪贴板不可用）'
    return
  }
  markCopied(item)
}

/** 图片复制：调 copy 通道（主进程 clipboard.write），结构化错误 → 中文文案 */
async function onCopyImage(item: Entry): Promise<void> {
  copyError.value = ''
  try {
    await copyImage(item.id)
  } catch (err) {
    copyError.value = toStructuredError(err).message
    return
  }
  markCopied(item)
}

/** 条目复制入口：按类型分流（图片渲染端 clipboard API 写不了图） */
function onCopyEntry(item: Entry): void {
  if (item.type === 'image') void onCopyImage(item)
  else void onCopy(item)
}

/** 打开图片预览（此时才调 image 通道取原图 dataURL） */
function openPreview(item: Entry): void {
  previewItem.value = item
  previewShow.value = true
  void fetchPreview(item)
}

/** 拉取预览原图（CH_IMAGE_MISSING → 中文文案 + 重试） */
async function fetchPreview(item: Entry): Promise<void> {
  previewLoading.value = true
  previewError.value = null
  previewDataUrl.value = ''
  try {
    const result = await loadImage(item.id)
    previewDataUrl.value = result.dataUrl
  } catch (err) {
    previewError.value = toStructuredError(err)
  } finally {
    previewLoading.value = false
  }
}

/** 预览失败重试（重新调 image 通道） */
function retryPreview(): void {
  const item = previewItem.value
  if (item !== null) void fetchPreview(item)
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

/** 删除单条（图片条目主进程同步删 PNG） */
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

/** 清空全部历史（NPopconfirm 二次确认回调，图片文件全删） */
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
    <!-- 顶栏：搜索 + 类型分段筛选 + 条数徽标（随过滤更新） + 清空二次确认 -->
    <div class="flex flex-wrap items-center gap-2">
      <NInput
        v-model:value="query"
        clearable
        :maxlength="MAX_QUERY_LENGTH"
        placeholder="搜索剪贴板内容"
        class="w-64"
      />
      <NRadioGroup :value="typeFilter" size="small" @update:value="onTypeFilterChange">
        <NRadioButton value="all">全部</NRadioButton>
        <NRadioButton value="text">文本</NRadioButton>
        <NRadioButton value="image">图片</NRadioButton>
      </NRadioGroup>
      <NText depth="3" class="text-xs tabular-nums">{{ summary }}</NText>
      <NPopconfirm positive-text="确认" @positive-click="onClear">
        <template #trigger>
          <NButton size="small" type="error" quaternary class="ml-auto">清空</NButton>
        </template>
        清空全部历史（含置顶）？
      </NPopconfirm>
    </div>

    <!-- 文本 >100KB / 图片 >5MB 一次性提示（不入库） -->
    <NAlert v-if="tooLarge" type="warning" closable role="alert" @close="tooLarge = false">
      剪贴板内容过大（文本&gt;100KB / 图片&gt;5MB），已跳过
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

    <!-- 空态 / 搜索与筛选无命中 -->
    <div v-else-if="filtered.length === 0" class="flex min-h-40 flex-1 items-center justify-center">
      <NEmpty
        :description="items.length === 0 ? '复制任意文本或图片后自动出现在这里' : '没有匹配的条目'"
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
          <!-- 文本预览 / 图片缩略图（点开预览 Modal） -->
          <p
            v-if="item.type !== 'image'"
            class="min-w-0 flex-1 font-mono text-sm break-all whitespace-pre-wrap line-clamp-3"
          >
            {{ item.text }}
          </p>
          <button
            v-else
            type="button"
            class="shrink-0 cursor-zoom-in overflow-hidden rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)]"
            aria-label="打开图片预览"
            @click="openPreview(item)"
          >
            <img
              :src="item.thumb"
              alt="剪贴板图片缩略图"
              class="max-h-28 max-w-40 object-contain"
            />
          </button>
          <div class="flex shrink-0 items-center gap-1">
            <NButton size="tiny" quaternary @click="onCopyEntry(item)">
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
          <span v-if="item.type === 'image'" class="inline-flex items-center gap-1 tabular-nums">
            <ImageIcon class="h-3 w-3" />{{ formatImageStats(item) }}
          </span>
          <span v-else>{{ formatTextStats(item.text) }}</span>
          <span class="tabular-nums">{{ formatRelativeTime(item.createdAt, now) }}</span>
        </div>
      </li>
    </ul>

    <!-- 图片预览 Modal：打开时才取原图；加载中 / CH_IMAGE_MISSING 重试 / 原图展示 -->
    <NModal v-model:show="previewShow" preset="card" title="图片预览" class="w-[min(90vw,880px)]">
      <div class="flex min-h-40 items-center justify-center">
        <div v-if="previewLoading" class="flex items-center gap-2" role="status">
          <NSpin :size="18" />
          <NText depth="3" class="text-sm">正在加载图片…</NText>
        </div>
        <div v-else-if="previewError !== null" class="flex flex-col items-center gap-3">
          <NText type="error">{{ previewError.message }}</NText>
          <NText depth="3" class="text-xs">{{ previewError.code }}</NText>
          <NButton size="small" @click="retryPreview">重试</NButton>
        </div>
        <img
          v-else-if="previewDataUrl !== ''"
          :src="previewDataUrl"
          alt="剪贴板图片预览"
          class="max-h-[70vh] max-w-full object-contain"
        />
      </div>
    </NModal>

    <!-- 复制失败（剪贴板不可用 / 图片文件丢失） -->
    <NText v-if="copyError !== ''" type="error" class="text-xs">{{ copyError }}</NText>
  </div>
</template>
