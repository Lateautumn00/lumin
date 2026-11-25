<script setup lang="ts">
// 文件扫描 - 目录对比页签（M71 合并自 folder-compare）
// 作者：cuilanchao · 修改时间：2026-11-25
// 三态强制（空态左右目录引导/加载两侧扫描进度可取消/报错码 + 详情）；
// 左右目录递归扫描后按相对路径配对比较元数据（大小/修改时间），只读不修改文件（spec §3）
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, NCheckbox, NEmpty, NInput, NSelect, NTag, NText } from 'naive-ui'
import { ArrowLeftRight, CircleAlert, FolderOpen } from '@lucide/vue'
import {
  formatBytes,
  formatTime,
  toStructuredError,
  type StructuredError,
  type TaskEvent
} from '@lumin/shared'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import PathLink from '@lumin/ui/PathLink.vue'
import {
  filterEntries,
  joinRootPath,
  limitEntries,
  sortEntries,
  type DiffFilterStatus
} from '../../compare/contract'
import { isRetryable } from '../../compare/errors'
import {
  MAX_VISIBLE_ENTRIES,
  type CompareEntry,
  type CompareResult
} from '../../compare/schema'
import {
  compareConfig as config,
  compareDirectories as compare,
  setCompareConfig as setConfig
} from '../client'

type Side = 'left' | 'right'

// —— 目录与选项 ——
const leftRoot = ref('')
const rightRoot = ref('')
const compareMtime = ref(true)
const compareContent = ref(false)

// —— 任务与结果 ——
const phase = ref<'idle' | 'running'>('idle')
const progress = ref<{ current: number; total?: number; stage?: string } | null>(null)
const result = ref<CompareResult | null>(null)
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')
const notice = ref('')

// —— 结果筛选 ——
const filterStatus = ref<DiffFilterStatus>('all')
const keyword = ref('')

let unsubscribe: (() => void) | null = null
let currentTaskId = ''
/** invoke 返回 taskId 前已到达的事件（小目录可能瞬间完成，先订阅后提交） */
let pendingEvents: TaskEvent[] = []

const busy = computed(() => phase.value !== 'idle')
const canStart = computed(() => leftRoot.value !== '' && rightRoot.value !== '' && !busy.value)

/** 状态筛选下拉项（spec §3.4） */
const statusOptions: { label: string; value: DiffFilterStatus }[] = [
  { label: '全部', value: 'all' },
  { label: '仅差异', value: 'changed' },
  { label: '仅左侧', value: 'only-left' },
  { label: '仅右侧', value: 'only-right' },
  { label: '元数据相同', value: 'same' }
]

/** 排序后全量结果 */
const sorted = computed(() => sortEntries(result.value?.entries ?? []))
/** 状态 + 关键字筛选后结果 */
const matched = computed(() =>
  filterEntries(sorted.value, { status: filterStatus.value, keyword: keyword.value })
)
const visible = computed(() => limitEntries(matched.value, MAX_VISIBLE_ENTRIES))

const progressMessage = computed(() => {
  const current = progress.value
  if (current === null) return ''
  if (current.stage === 'content') {
    return `正在比较文件内容 · ${current.current} / ${current.total ?? 0} 个文件`
  }
  const side = current.stage === 'right' ? '右侧' : '左侧'
  return `正在扫描${side}目录 · 已检查 ${current.current} 个文件`
})

const summaryText = computed(() => {
  const done = result.value
  if (done === null) return ''
  const skipped = done.skipped > 0 ? ` · 跳过 ${done.skipped}` : ''
  const content = done.compareContent ? ` · 内容不同 ${done.contentDifferent}` : ''
  return `仅左侧 ${done.onlyLeft} · 仅右侧 ${done.onlyRight} · 有差异 ${done.different} · 相同 ${done.same}${content}${skipped} · 耗时 ${(done.elapsedMs / 1000).toFixed(1)}s`
})

const scaleText = computed(() => {
  const done = result.value
  if (done === null) return ''
  return `左侧 ${done.leftFiles} 个文件 · 右侧 ${done.rightFiles} 个文件`
})

const countText = computed(() => {
  if (result.value === null) return ''
  return `共 ${matched.value.length} 条 · 展示 ${visible.value.shown.length} 条`
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

/** 保存左右目录与开关（失败不打断交互） */
async function persist(): Promise<void> {
  try {
    await setConfig({
      leftRoot: leftRoot.value,
      rightRoot: rightRoot.value,
      compareMtime: compareMtime.value,
      compareContent: compareContent.value
    })
  } catch {
    // 记忆失败不影响本次对比
  }
}

/** 选择目录（取消保持原值） */
async function chooseDir(side: Side): Promise<void> {
  error.value = null
  try {
    const picked = await window.lumin.pickDirectory(side === 'left' ? '选择左侧目录' : '选择右侧目录')
    if (picked === null) return
    detach()
    if (side === 'left') leftRoot.value = picked
    else rightRoot.value = picked
    result.value = null
    notice.value = ''
    await persist()
  } catch (err) {
    showError(err)
  }
}

/** 交换左右目录（有结果时清空，防方向歧义） */
function swap(): void {
  if (busy.value) return
  const left = leftRoot.value
  leftRoot.value = rightRoot.value
  rightRoot.value = left
  result.value = null
  notice.value = ''
  void persist()
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
    result.value = event.result as CompareResult
    return
  }
  if (event.error.code === 'CANCELLED') {
    notice.value = '已取消对比'
    return
  }
  error.value = event.error
  errorDetail.value = event.error.detail ?? ''
}

/** 提交对比任务 */
async function start(): Promise<void> {
  if (!canStart.value) return
  detach()
  error.value = null
  errorDetail.value = ''
  notice.value = ''
  result.value = null
  phase.value = 'running'
  progress.value = { current: 0, stage: 'left' }
  pendingEvents = []
  unsubscribe = window.lumin.onTaskEvent(onEvent)
  try {
    const { taskId } = await compare({
      leftRoot: leftRoot.value,
      rightRoot: rightRoot.value,
      compareMtime: compareMtime.value,
      compareContent: compareContent.value
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

function reveal(side: Side, entry: CompareEntry): void {
  const root = side === 'left' ? leftRoot.value : rightRoot.value
  if (root === '') return
  void window.lumin.revealPath(joinRootPath(root, entry.path)).catch(showError)
}

function retry(): void {
  error.value = null
  errorDetail.value = ''
  void start()
}

/** 状态标签文案（有差异细分大小/时间） */
function statusText(entry: CompareEntry): string {
  if (entry.status === 'only-left') return '仅左侧'
  if (entry.status === 'only-right') return '仅右侧'
  if (entry.contentChanged) return '内容不同'
  if (entry.status === 'same') return '相同'
  if (entry.sizeChanged && entry.mtimeChanged) return '大小/时间不同'
  return entry.sizeChanged ? '大小不同' : '时间不同'
}

function tagType(entry: CompareEntry): 'warning' | 'info' | 'error' | 'success' {
  if (entry.status === 'only-left') return 'warning'
  if (entry.status === 'only-right') return 'info'
  if (entry.status === 'different') return 'error'
  return 'success'
}

/** 单侧元数据文案（缺失侧显示「不存在」） */
function metaText(size: number | null, mtime: number | null): string {
  if (size === null || mtime === null) return '不存在'
  return `${formatBytes(size)} · ${formatTime(mtime)}`
}

watch(compareMtime, () => {
  void persist()
})

watch(compareContent, () => {
  void persist()
})

onMounted(() => {
  void config()
    .then((saved) => {
      leftRoot.value = saved.leftRoot ?? ''
      rightRoot.value = saved.rightRoot ?? ''
      compareMtime.value = saved.compareMtime
      compareContent.value = saved.compareContent
    })
    .catch(() => undefined)
})

onUnmounted(detach)
</script>

<template>
  <div class="flex max-w-5xl flex-col gap-4">
    <div>
      <p class="text-sm text-[var(--lumin-color-text-secondary)]">
        按相对路径对比左右两个目录的文件（大小 / 修改时间），只读分析，不会修改任何文件。
      </p>
    </div>

    <!-- 左右目录与选项 -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <NInput :value="leftRoot" placeholder="选择左侧目录" readonly :disabled="busy" />
        <NButton :disabled="busy" @click="chooseDir('left')">
          <FolderOpen class="mr-1 h-3.5 w-3.5" />左侧
        </NButton>
        <NButton :disabled="busy" quaternary title="交换左右" @click="swap">
          <ArrowLeftRight class="h-3.5 w-3.5" aria-label="交换左右" />
        </NButton>
      </div>
      <div class="flex items-center gap-2">
        <NInput :value="rightRoot" placeholder="选择右侧目录" readonly :disabled="busy" />
        <NButton :disabled="busy" @click="chooseDir('right')">
          <FolderOpen class="mr-1 h-3.5 w-3.5" />右侧
        </NButton>
        <span class="w-7 shrink-0" />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <NCheckbox v-model:checked="compareMtime" :disabled="busy">比较修改时间（容差 2 秒）</NCheckbox>
        <NCheckbox v-model:checked="compareContent" :disabled="busy">
          比较文件内容（SHA-256，较慢）
        </NCheckbox>
        <NButton type="primary" :disabled="!canStart" @click="start">开始对比</NButton>
      </div>
    </div>

    <!-- 空态：未选齐目录 / 筛选无匹配 -->
    <NEmpty
      v-if="leftRoot === '' || rightRoot === ''"
      description="先选择左右两个目录，再点击「开始对比」；默认只比较元数据，勾选「比较文件内容」后对同名同大小文件做 SHA-256"
    />
    <NEmpty
      v-else-if="result !== null && matched.length === 0 && !busy"
      description="当前筛选无匹配项"
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
          v-if="isRetryable(error.code) && leftRoot !== '' && rightRoot !== '' && !busy"
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
    <template v-if="result !== null">
      <div class="flex flex-col gap-1">
        <NText class="text-sm font-medium">{{ summaryText }}</NText>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <NText depth="3" class="text-xs">{{ scaleText }}</NText>
          <NText v-if="result.truncated > 0" depth="3" class="text-xs">
            结果超过上限，省略 {{ result.truncated }} 条（缩小目录范围后重试）
          </NText>
        </div>
      </div>

      <!-- 筛选 -->
      <div class="flex flex-wrap items-center gap-2">
        <NSelect v-model:value="filterStatus" :options="statusOptions" class="w-32" />
        <NInput v-model:value="keyword" placeholder="按相对路径筛选" clearable class="max-w-64" />
        <NText depth="3" class="text-xs">{{ countText }}</NText>
      </div>

      <div
        class="flex flex-col rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)]"
      >
        <div
          v-for="entry in visible.shown"
          :key="entry.path"
          class="flex items-start gap-3 border-b border-[var(--lumin-color-border)] px-3 py-2 last:border-b-0"
        >
          <NTag :type="tagType(entry)" size="small" class="w-28 shrink-0 justify-center">
            {{ statusText(entry) }}
          </NTag>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm">
              <PathLink :path="entry.path" :reveal="false" />
            </div>
            <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--lumin-color-text-secondary)]">
              <span>左：{{ metaText(entry.sizeLeft, entry.mtimeLeft) }}</span>
              <span>右：{{ metaText(entry.sizeRight, entry.mtimeRight) }}</span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <NButton
              size="tiny"
              quaternary
              aria-label="定位左侧"
              :disabled="entry.sizeLeft === null"
              @click="reveal('left', entry)"
            >
              <FolderOpen class="h-3.5 w-3.5" />
            </NButton>
            <NButton
              size="tiny"
              quaternary
              aria-label="定位右侧"
              :disabled="entry.sizeRight === null"
              @click="reveal('right', entry)"
            >
              <FolderOpen class="h-3.5 w-3.5" />
            </NButton>
          </div>
        </div>
      </div>

      <NText v-if="visible.hiddenCount > 0" depth="3" class="text-xs">
        其余 {{ visible.hiddenCount }} 条未展示（单页最多 {{ MAX_VISIBLE_ENTRIES }} 条，请用筛选缩小范围）
      </NText>

      <NText v-if="result.compareContent" depth="3" class="text-xs">
        「相同」表示大小与文件内容（SHA-256）一致；修改时间比较{{ result.compareMtime ? '已开启' : '已关闭' }}。
      </NText>
      <NText v-else depth="3" class="text-xs">
        「相同」表示大小与修改时间一致（元数据比较），不代表文件内容逐字节相同；勾选「比较文件内容」可校验 SHA-256。
      </NText>
    </template>
  </div>
</template>
