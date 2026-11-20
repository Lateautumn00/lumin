<script setup lang="ts">
// 磁盘空间分析主视图（M23）
// 作者：cuilanchao · 修改时间：2026-11-20
// 三态强制（空态选目录引导/加载进度可取消/报错码 + 详情）；扫描走 worker 递归聚合，
// 直接子项按大小降序 + 占比条，点击目录逐级下钻，面包屑返回（spec §3）
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, NEmpty, NInput, NSelect, NText } from 'naive-ui'
import { CircleAlert, File, Folder, FolderOpen, Search } from '@lucide/vue'
import {
  fileNameOf,
  formatBytes,
  toStructuredError,
  type StructuredError,
  type TaskEvent
} from '@lumin/shared'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import {
  breadcrumbParts,
  breadcrumbPath,
  filterEntries,
  isInside,
  limitEntries,
  percentOf,
  sortEntries,
  summarize
} from '../contract'
import { isRetryable } from '../errors'
import {
  DEFAULT_MIN_FILE_BYTES,
  MAX_VISIBLE_ENTRIES,
  MIN_FILE_BYTES_OPTIONS,
  type DiskEntry,
  type ScanResult
} from '../schema'
import { config, scan, setConfig } from './client'

// —— 目录 ——
/** 用户选择的起始目录（面包屑基准，下钻不改变） */
const baseRoot = ref('')
/** 当前扫描/展示的目录（下钻时变化） */
const root = ref('')
const minFileBytes = ref<number>(DEFAULT_MIN_FILE_BYTES)

// —— 任务与结果 ——
const phase = ref<'idle' | 'running'>('idle')
const progress = ref<{ current: number; stage?: string } | null>(null)
const entries = ref<DiskEntry[]>([])
const stats = ref<ScanResult | null>(null)
const scanned = ref(false)
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')
const notice = ref('')

let unsubscribe: (() => void) | null = null
let currentTaskId = ''
/** invoke 返回 taskId 前已到达的事件（小目录可能瞬间完成，先订阅后提交） */
let pendingEvents: TaskEvent[] = []

const busy = computed(() => phase.value !== 'idle')
const crumbs = computed(() => breadcrumbParts(baseRoot.value, root.value))
const layer = computed(() => summarize(entries.value))
const visible = computed(() =>
  limitEntries(filterEntries(entries.value, minFileBytes.value), MAX_VISIBLE_ENTRIES)
)
const baseLabel = computed(() =>
  baseRoot.value === '' ? '' : fileNameOf(baseRoot.value) || baseRoot.value
)

/** 最小文件阈值下拉项（spec §3：0 / 1KB / 100KB / 1MB） */
const MIN_BYTES_LABELS: Record<number, string> = {
  0: '全部',
  1024: '≥ 1 KB',
  102400: '≥ 100 KB',
  1048576: '≥ 1 MB'
}
const minBytesOptions = MIN_FILE_BYTES_OPTIONS.map((value) => ({
  label: MIN_BYTES_LABELS[value] ?? formatBytes(value),
  value
}))

const progressMessage = computed(() => {
  const current = progress.value
  if (current === null) return ''
  return `正在扫描目录 · 已检查 ${current.current} 个文件`
})

/** 本次扫描汇总（总大小/文件数/目录数/跳过/耗时） */
const statsText = computed(() => {
  const done = stats.value
  if (done === null) return ''
  const skipped = done.skipped > 0 ? ` · 跳过 ${done.skipped}` : ''
  return `共 ${formatBytes(done.totalBytes)} · ${done.fileCount} 个文件 · ${done.dirCount} 个目录${skipped} · 耗时 ${(done.elapsedMs / 1000).toFixed(1)}s`
})

/** 当前层直接子项统计 */
const layerText = computed(() => `本层 ${layer.value.dirs} 个目录 · ${layer.value.files} 个文件`)

/** 条目占比（相对本次扫描总大小） */
function entryPercent(entry: DiskEntry): number {
  return percentOf(entry.size, stats.value?.totalBytes ?? 0)
}

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

/** 保存起始目录与阈值（失败不打断交互） */
async function persist(): Promise<void> {
  try {
    await setConfig({
      ...(baseRoot.value !== '' ? { root: baseRoot.value } : {}),
      minFileBytes: minFileBytes.value
    })
  } catch {
    // 记忆失败不影响本次扫描
  }
}

/** 选择目录（取消保持原值） */
async function chooseDir(): Promise<void> {
  error.value = null
  try {
    const picked = await window.lumin.pickDirectory('选择要分析的目录')
    if (picked === null) return
    detach()
    baseRoot.value = picked
    root.value = picked
    entries.value = []
    stats.value = null
    scanned.value = false
    notice.value = ''
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
    progress.value = { current: event.current, stage: event.stage }
    return
  }
  if (event.kind === 'log') return
  detach()
  phase.value = 'idle'
  progress.value = null
  if (event.kind === 'done') {
    const done = event.result as ScanResult
    entries.value = sortEntries(done.entries)
    stats.value = done
    scanned.value = true
    return
  }
  if (event.error.code === 'CANCELLED') {
    notice.value = '已取消扫描'
    return
  }
  error.value = event.error
  errorDetail.value = event.error.detail ?? ''
}

/** 提交扫描任务（当前 root） */
async function start(): Promise<void> {
  if (root.value === '' || busy.value) return
  detach()
  error.value = null
  errorDetail.value = ''
  notice.value = ''
  entries.value = []
  stats.value = null
  scanned.value = false
  phase.value = 'running'
  progress.value = { current: 0, stage: 'scan' }
  pendingEvents = []
  unsubscribe = window.lumin.onTaskEvent(onEvent)
  try {
    const { taskId } = await scan({ root: root.value, minFileBytes: minFileBytes.value })
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

/** 下钻到子目录（仅限起始目录内） */
function drill(entry: DiskEntry): void {
  if (busy.value || entry.kind !== 'dir' || !isInside(baseRoot.value, entry.path)) return
  root.value = entry.path
  void start()
}

/** 面包屑跳转：depth < 0 回起始目录，否则回到第 depth 级 */
function goTo(depth: number): void {
  if (busy.value) return
  root.value = depth < 0 ? baseRoot.value : breadcrumbPath(baseRoot.value, crumbs.value, depth)
  void start()
}

async function reveal(path: string): Promise<void> {
  try {
    await window.lumin.revealPath(path)
  } catch (err) {
    showError(err)
  }
}

function retry(): void {
  error.value = null
  errorDetail.value = ''
  void start()
}

watch(minFileBytes, () => {
  void persist()
})

onMounted(() => {
  void config()
    .then((saved) => {
      if (saved.root !== null) {
        baseRoot.value = saved.root
        root.value = saved.root
      }
      minFileBytes.value = saved.minFileBytes
    })
    .catch(() => undefined)
})

onUnmounted(detach)
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">磁盘空间分析</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        扫描目录查看各子项占用大小（子目录含全部后代），按大小排序并逐级下钻；只读分析，不会修改任何文件。
      </p>
    </div>

    <!-- 目录与阈值 -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <NInput :value="root" placeholder="选择要分析的目录" readonly />
        <NButton :disabled="busy" @click="chooseDir">
          <FolderOpen class="mr-1 h-3.5 w-3.5" />选择目录
        </NButton>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <NText depth="2" class="text-sm">最小文件</NText>
        <NSelect v-model:value="minFileBytes" :options="minBytesOptions" :disabled="busy" class="w-32" />
        <NButton type="primary" :disabled="busy || root === ''" @click="start">
          <Search class="mr-1 h-3.5 w-3.5" />开始扫描
        </NButton>
      </div>
    </div>

    <!-- 空态：未选目录 / 已扫描但为空 -->
    <NEmpty v-if="root === ''" description="先选择要分析的目录，再点击「开始扫描」" />
    <NEmpty
      v-else-if="scanned && entries.length === 0 && !busy"
      description="该目录为空或无可访问文件"
    />

    <!-- 加载态：进度可见 + 可取消（R4 强制） -->
    <TaskProgress
      v-if="phase !== 'idle' && progress !== null"
      :message="progressMessage"
      :current="progress.current"
      @cancel="cancelTask"
    />

    <!-- 提示（取消等） -->
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
        <summary class="cursor-pointer text-xs text-[var(--lumin-color-text-secondary)]">详情</summary>
        <NText depth="3" class="block break-all text-xs">{{ errorDetail }}</NText>
      </details>
    </div>

    <!-- 结果 -->
    <template v-if="entries.length > 0">
      <div class="flex flex-col gap-1">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <NText class="text-sm font-medium">{{ statsText }}</NText>
          <NText depth="3" class="text-xs">{{ layerText }}</NText>
        </div>
        <!-- 面包屑：起始目录 / 子级… -->
        <div class="flex flex-wrap items-center gap-1">
          <NButton size="tiny" quaternary :disabled="busy" @click="goTo(-1)">
            {{ baseLabel }}
          </NButton>
          <template v-for="(part, index) in crumbs" :key="`${index}-${part}`">
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">/</span>
            <NButton size="tiny" quaternary :disabled="busy" @click="goTo(index)">
              {{ part }}
            </NButton>
          </template>
        </div>
      </div>

      <div class="flex flex-col rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)]">
        <div
          v-for="entry in visible.shown"
          :key="entry.path"
          class="flex items-center gap-3 border-b border-[var(--lumin-color-border)] px-3 py-2 last:border-b-0"
        >
          <Folder
            v-if="entry.kind === 'dir'"
            class="h-4 w-4 shrink-0 text-[var(--lumin-color-text-secondary)]"
          />
          <File v-else class="h-4 w-4 shrink-0 text-[var(--lumin-color-text-secondary)]" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1">
              <button
                v-if="entry.kind === 'dir'"
                type="button"
                class="truncate text-left text-sm hover:underline"
                :title="entry.path"
                @click="drill(entry)"
              >
                {{ entry.name }}
              </button>
              <span v-else class="truncate text-sm" :title="entry.path">{{ entry.name }}</span>
              <NText v-if="entry.kind === 'dir'" depth="3" class="whitespace-nowrap text-xs">
                （{{ entry.fileCount }} 个文件）
              </NText>
            </div>
            <div class="mt-1 h-1.5 w-full rounded-full bg-[var(--lumin-color-border)]">
              <div
                class="h-1.5 rounded-full bg-[var(--lumin-color-primary)]"
                :style="{ width: `${entryPercent(entry)}%` }"
              />
            </div>
          </div>
          <NText class="w-24 whitespace-nowrap text-right text-sm">{{ formatBytes(entry.size) }}</NText>
          <NText depth="3" class="w-12 whitespace-nowrap text-right text-xs">
            {{ entryPercent(entry) }}%
          </NText>
          <NButton
            v-if="entry.kind === 'file'"
            size="tiny"
            quaternary
            :disabled="busy"
            @click="reveal(entry.path)"
          >
            <FolderOpen class="h-3.5 w-3.5" aria-label="定位" />
          </NButton>
        </div>
      </div>

      <NText v-if="visible.hiddenCount > 0" depth="3" class="text-xs">
        其余 {{ visible.hiddenCount }} 项 · 共 {{ formatBytes(visible.hiddenBytes) }}（单层仅展示最大
        {{ MAX_VISIBLE_ENTRIES }} 项）
      </NText>
    </template>
  </div>
</template>
