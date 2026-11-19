<script setup lang="ts">
// 重复文件查找主视图（M18）
// 作者：cuilanchao · 修改时间：2026-11-19
// 三态强制（空态选目录引导/加载进度可取消/报错码 + 详情）；扫描走 worker 两段哈希，
// 默认每组保留最早一份，支持定位与移入回收站（spec §2/§6）
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NCheckbox, NEmpty, NInput, NPopconfirm, NSelect, NText } from 'naive-ui'
import { CircleAlert, FolderOpen, Search, Trash2 } from '@lucide/vue'
import {
  fileNameOf,
  formatBytes,
  formatTime,
  toStructuredError,
  type StructuredError,
  type TaskEvent
} from '@lumin/shared'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { config, scan, setConfig } from './client'
import { autoSelect, removePaths, summarize } from '../contract'
import { isRetryable } from '../errors'
import {
  DEFAULT_MIN_BYTES,
  DEFAULT_RECURSIVE,
  MIN_BYTES_OPTIONS,
  type DuplicateGroup,
  type ScanResult
} from '../schema'

// —— 输入 ——
const root = ref('')
const recursive = ref(DEFAULT_RECURSIVE)
const minBytes = ref<number>(DEFAULT_MIN_BYTES)

// —— 任务与结果 ——
const phase = ref<'idle' | 'scanning'>('idle')
const progress = ref<{
  current: number
  total?: number
  stage?: string
  message?: string
} | null>(null)
const groups = ref<DuplicateGroup[]>([])
const stats = ref<Pick<ScanResult, 'scannedFiles' | 'skipped' | 'elapsedMs'> | null>(null)
const selected = ref<Set<string>>(new Set())
const scanned = ref(false)
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')
const notice = ref('')

let unsubscribe: (() => void) | null = null
let currentTaskId = ''
/** invoke 返回 taskId 前已到达的事件（小目录可能瞬间完成，先订阅后提交） */
let pendingEvents: TaskEvent[] = []

const busy = computed(() => phase.value !== 'idle')
const summary = computed(() => summarize(groups.value))
const selectedCount = computed(() => selected.value.size)
const selectedBytes = computed(() => {
  let total = 0
  for (const group of groups.value) {
    for (const file of group.files) {
      if (selected.value.has(file.path)) total += group.size
    }
  }
  return total
})
const allSelected = computed(() => {
  const total = summary.value.files
  return total > 0 && selectedCount.value === total
})

/** 最小文件大小下拉项（spec §1：1KB / 100KB / 1MB / 10MB） */
const MIN_BYTES_LABELS: Record<number, string> = {
  1024: '1 KB',
  102400: '100 KB',
  1048576: '1 MB',
  10485760: '10 MB'
}
const minBytesOptions = MIN_BYTES_OPTIONS.map((value) => ({
  label: MIN_BYTES_LABELS[value] ?? formatBytes(value),
  value
}))

const progressMessage = computed(() => {
  const current = progress.value
  if (current === null) return ''
  if (current.stage === 'scan') return `正在扫描目录 · 已检查 ${current.current} 个文件`
  if (current.stage === 'partial') {
    return `正在预筛（大小 + 前缀哈希）· ${current.current} / ${current.total ?? 0}`
  }
  const name = current.message !== undefined && current.message !== '' ? fileNameOf(current.message) : ''
  const bytes = `${formatBytes(current.current)} / ${formatBytes(current.total ?? 0)}`
  return `正在校验${name !== '' ? ` · ${name}` : ''} · ${bytes}`
})

/** 扫描摘要（文件数/跳过数/耗时） */
const statsText = computed(() => {
  const done = stats.value
  if (done === null) return ''
  const seconds = (done.elapsedMs / 1000).toFixed(1)
  const skipped = done.skipped > 0 ? ` · 跳过 ${done.skipped}` : ''
  return `扫描 ${done.scannedFiles} 个文件${skipped} · 耗时 ${seconds}s`
})

function detach(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  currentTaskId = ''
  pendingEvents = []
}

function showError(err: unknown): void {
  const structured = toStructuredError(err)
  error.value = structured
  errorDetail.value = structured.detail ?? ''
  phase.value = 'idle'
  progress.value = null
  detach()
}

/** 保存当前目录与选项（失败不打断交互） */
async function persist(): Promise<void> {
  try {
    await setConfig({
      ...(root.value !== '' ? { root: root.value } : {}),
      recursive: recursive.value,
      minBytes: minBytes.value
    })
  } catch {
    // 记忆失败不影响本次扫描
  }
}

/** 选择目录（取消保持原值） */
async function chooseDir(): Promise<void> {
  error.value = null
  try {
    const picked = await window.lumin.pickDirectory('选择要扫描的目录')
    if (picked === null) return
    root.value = picked
    await persist()
  } catch (err) {
    showError(err)
  }
}

function onEvent(event: TaskEvent): void {
  if (currentTaskId === '') {
    pendingEvents.push(event)
    return
  }
  if (event.taskId !== currentTaskId) return
  if (event.kind === 'progress') {
    progress.value = {
      current: event.current,
      total: event.total,
      stage: event.stage,
      message: event.message
    }
    return
  }
  if (event.kind === 'log') return
  detach()
  phase.value = 'idle'
  progress.value = null
  if (event.kind === 'done') {
    const done = event.result as ScanResult
    groups.value = done.groups
    stats.value = {
      scannedFiles: done.scannedFiles,
      skipped: done.skipped,
      elapsedMs: done.elapsedMs
    }
    selected.value = autoSelect(done.groups)
    scanned.value = true
    notice.value =
      done.groups.length > 0
        ? `发现 ${done.groups.length} 组重复文件，已默认勾选「每组保留最早一份」之外的文件`
        : '未发现重复文件'
    return
  }
  if (event.error.code === 'CANCELLED') {
    notice.value = '已取消扫描'
    return
  }
  error.value = event.error
  errorDetail.value = event.error.detail ?? ''
}

/** 提交扫描任务 */
async function start(): Promise<void> {
  if (root.value === '' || busy.value) return
  error.value = null
  errorDetail.value = ''
  notice.value = ''
  groups.value = []
  stats.value = null
  selected.value = new Set()
  phase.value = 'scanning'
  progress.value = { current: 0, stage: 'scan' }
  pendingEvents = []
  unsubscribe = window.lumin.onTaskEvent(onEvent)
  try {
    await persist()
    const { taskId } = await scan({
      root: root.value,
      recursive: recursive.value,
      minBytes: minBytes.value
    })
    currentTaskId = taskId
    // 回放提交期间已到达的事件（小目录瞬间完成时 done 早于 invoke 返回）
    const replay = pendingEvents.splice(0)
    for (const event of replay) {
      if (event.taskId === taskId) onEvent(event)
    }
  } catch (err) {
    showError(err)
  }
}

async function cancelTask(): Promise<void> {
  if (currentTaskId === '') return
  try {
    await window.lumin.invoke('lumin:task:cancel', { taskId: currentTaskId })
  } catch (err) {
    showError(err)
  }
}

/** 勾选/取消单个文件（替换 Set 触发响应式） */
function toggle(path: string, checked: boolean): void {
  const next = new Set(selected.value)
  if (checked) next.add(path)
  else next.delete(path)
  selected.value = next
}

/** 全选 / 全不选 */
function toggleAll(checked: boolean): void {
  if (!checked) {
    selected.value = new Set()
    return
  }
  const next = new Set<string>()
  for (const group of groups.value) {
    for (const file of group.files) next.add(file.path)
  }
  selected.value = next
}

/** 保留每组最早一份（默认勾选口径） */
function keepEarliest(): void {
  selected.value = autoSelect(groups.value)
}

async function reveal(path: string): Promise<void> {
  try {
    await window.lumin.revealPath(path)
  } catch (err) {
    showError(err)
  }
}

/** 移入回收站并归一结果 */
async function trashSelected(): Promise<void> {
  if (selected.value.size === 0) return
  error.value = null
  try {
    const outcome = await window.lumin.trashPaths([...selected.value])
    const trashed = new Set(outcome.trashed)
    if (trashed.size > 0) {
      groups.value = removePaths(groups.value, trashed)
      const next = new Set(selected.value)
      for (const path of trashed) next.delete(path)
      selected.value = next
    }
    if (outcome.failed.length === 0) {
      notice.value = `已移入回收站 ${outcome.trashed.length} 个文件`
    } else {
      const first = outcome.failed[0]
      notice.value = `已移入回收站 ${outcome.trashed.length} 个；${outcome.failed.length} 个失败（${first?.message ?? '原因未知'}）`
    }
  } catch (err) {
    showError(err)
  }
}

function retry(): void {
  error.value = null
  errorDetail.value = ''
  void start()
}

onMounted(() => {
  void config()
    .then((saved) => {
      if (saved.root !== null) root.value = saved.root
      recursive.value = saved.recursive
      minBytes.value = saved.minBytes
    })
    .catch(() => undefined)
})

onUnmounted(detach)
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">重复文件查找</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        扫描目录找出内容完全相同的文件（大小 + SHA-256 两段校验）；默认每组保留最早一份，其余可移入回收站。
      </p>
    </div>

    <!-- 目录与选项 -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <NInput :value="root" placeholder="选择要扫描的目录" readonly />
        <NButton :disabled="busy" @click="chooseDir">
          <FolderOpen class="mr-1 h-3.5 w-3.5" />选择目录
        </NButton>
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <NCheckbox
          :checked="recursive"
          :disabled="busy"
          @update:checked="recursive = $event"
        >
          包含子目录
        </NCheckbox>
        <div class="flex items-center gap-2">
          <NText depth="2" class="text-sm">最小文件大小</NText>
          <NSelect
            v-model:value="minBytes"
            :options="minBytesOptions"
            :disabled="busy"
            class="w-28"
          />
        </div>
      </div>
    </div>

    <!-- 操作区 -->
    <div class="flex flex-wrap items-center gap-2">
      <NButton type="primary" :disabled="busy || root === ''" @click="start">
        <Search class="mr-1 h-3.5 w-3.5" />开始扫描
      </NButton>
      <template v-if="groups.length > 0 && !busy">
        <NButton size="small" quaternary @click="toggleAll(!allSelected)">
          {{ allSelected ? '全不选' : '全选' }}
        </NButton>
        <NButton size="small" quaternary @click="keepEarliest">保留每组最早一份</NButton>
        <NPopconfirm @positive-click="trashSelected">
          <template #trigger>
            <NButton type="error" :disabled="selectedCount === 0">
              <Trash2 class="mr-1 h-3.5 w-3.5" />移入回收站（{{ selectedCount }}）
            </NButton>
          </template>
          确认将 {{ selectedCount }} 个文件（共 {{ formatBytes(selectedBytes) }}）移入回收站？
        </NPopconfirm>
      </template>
    </div>

    <!-- 空态：未选目录 / 已扫描无重复 -->
    <NEmpty
      v-if="root === ''"
      description="先选择要扫描的目录，再点击「开始扫描」"
    />
    <NEmpty
      v-else-if="scanned && groups.length === 0 && !busy"
      description="未发现重复文件"
    />

    <!-- 加载态：进度可见 + 可取消（R4 强制） -->
    <TaskProgress
      v-if="phase !== 'idle' && progress !== null"
      :message="progressMessage"
      :current="progress.current"
      :total="progress.total"
      @cancel="cancelTask"
    />

    <!-- 提示（完成/取消/清理结果） -->
    <NText v-if="notice !== ''" depth="3" class="text-sm">{{ notice }}</NText>

    <!-- 报错态：结构化错误码 → 中文文案 + 重试/详情 -->
    <div v-if="error !== null" class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <NText type="error" class="text-sm">
          <CircleAlert class="mr-1 inline h-3.5 w-3.5" />{{ error.message }}
        </NText>
        <NButton
          v-if="isRetryable(error.code) && root !== '' && !busy"
          size="tiny"
          quaternary
          @click="retry"
        >
          重试
        </NButton>
      </div>
      <details v-if="errorDetail !== ''">
        <summary class="cursor-pointer text-xs text-[var(--lumin-color-text-secondary)]">
          详情
        </summary>
        <NText depth="3" class="block break-all text-xs">{{ errorDetail }}</NText>
      </details>
    </div>

    <!-- 结果 -->
    <template v-if="groups.length > 0">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <NText class="text-sm font-medium">
          {{ summary.groups }} 组 · {{ summary.files }} 个文件 · 可释放 {{ formatBytes(summary.wastedBytes) }}（已选 {{ formatBytes(selectedBytes) }}）
        </NText>
        <NText depth="3" class="text-xs">{{ statsText }}</NText>
      </div>

      <div class="flex flex-col gap-3">
        <div
          v-for="(group, index) in groups"
          :key="group.hash"
          class="df-group rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)]"
        >
          <div
            class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
          >
            <NText class="text-sm font-medium">
              第 {{ index + 1 }} 组 · {{ formatBytes(group.size) }} × {{ group.files.length }}
            </NText>
            <NText depth="3" class="text-xs">可释放 {{ formatBytes(group.wastedBytes) }}</NText>
          </div>
          <div
            v-for="file in group.files"
            :key="file.path"
            class="df-file flex items-center gap-2 border-b border-[var(--lumin-color-border, #e0e0e6)] px-3 py-1.5 last:border-b-0"
          >
            <NCheckbox
              :checked="selected.has(file.path)"
              :disabled="busy"
              @update:checked="toggle(file.path, $event)"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm" :title="file.path">{{ fileNameOf(file.path) }}</div>
              <div
                class="truncate text-xs text-[var(--lumin-color-text-secondary)]"
                :title="file.path"
              >
                {{ file.path }}
              </div>
            </div>
            <NText depth="3" class="whitespace-nowrap text-xs">{{ formatTime(file.mtimeMs) }}</NText>
            <NButton size="tiny" quaternary :disabled="busy" @click="reveal(file.path)">
              <FolderOpen class="h-3.5 w-3.5" aria-label="定位" />
            </NButton>
          </div>
        </div>
      </div>
      <NText depth="3" class="text-xs">
        移入回收站后可从系统回收站还原；删除前请确认勾选项。
      </NText>
    </template>
  </div>
</template>
