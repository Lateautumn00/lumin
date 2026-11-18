<script setup lang="ts">
// 批量重命名主视图（M7）
// 作者：cuilanchao · 修改时间：2026-11-18
// 三态强制（空态选目录引导/加载进度可取消/报错码 + 详情）、规则卡片按作用顺序、预览即时计算（spec §3）
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NCheckbox, NEmpty, NInput, NInputNumber, NText, NTag } from 'naive-ui'
import { CircleAlert, FolderOpen, RotateCcw, X } from '@lucide/vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { apply, config, scan, setDir, undo } from './client'
import { errorMessage, isRetryable } from '../errors'
import { buildRenamePlan, createDefaultRules, type PlanEntry, type RenameRules } from '../rules'
import type { RenameFailure, RenamePair, RenameTaskResult, ScanFile } from '../schema'

// —— 目录与文件列表 ——
const dir = ref('')
const files = ref<ScanFile[]>([])
const truncated = ref(false)
const scanning = ref(false)
const selected = ref<Set<string>>(new Set())

// —— 规则（默认值见 rules.ts createDefaultRules） ——
const rules = ref<RenameRules>(createDefaultRules())

// —— 任务与结果 ——
const phase = ref<'idle' | 'running'>('idle')
const progress = ref<{ current: number; total?: number; message?: string } | null>(null)
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')
/** 任务级notice（取消等非错误信息） */
const notice = ref('')
/** 本次执行失败条目（批量语义：失败不中断） */
const failures = ref<RenameFailure[]>([])
/** 最近一次成功改名的 pairs（会话内单次撤销依据） */
const lastRenamed = ref<RenamePair[]>([])
/** 最近一次任务成功条数 */
const doneCount = ref(0)

let unsubscribe: (() => void) | null = null
let currentTaskId = ''
/** 当前任务是撤销时置 true（done 分支据此清空 lastRenamed） */
let undoInFlight = false

/** 实时预览计划（规则/勾选/文件列表任一变化即重算；日期「当前时间」取计算时点） */
const plan = computed(() =>
  buildRenamePlan(files.value, rules.value, { selected: selected.value, now: new Date() })
)

/** 可执行行数（status=ok） */
const okEntries = computed(() => plan.value.entries.filter((entry) => entry.status === 'ok'))

/** 全选状态 */
const allSelected = computed(
  () => files.value.length > 0 && files.value.every((file) => selected.value.has(file.name))
)

/** 文件名 → 扫描元信息（行内展示大小/修改时间） */
const fileMap = computed(() => new Map(files.value.map((file) => [file.name, file])))

/** 行内元信息（大小 + 修改时间） */
function metaOf(name: string): string {
  const file = fileMap.value.get(name)
  if (file === undefined) return ''
  return `${formatBytes(file.size)} · ${formatTime(file.mtimeMs)}`
}

/** 体积人性化展示 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/** 修改时间展示（YYYY-MM-DD HH:mm） */
function formatTime(mtimeMs: number): string {
  const date = new Date(mtimeMs)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function detach(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  currentTaskId = ''
}

function showError(err: unknown): void {
  const structured = toStructuredError(err)
  error.value = structured
  errorDetail.value = structured.detail ?? ''
  phase.value = 'idle'
  progress.value = null
  detach()
}

/** 勾选/取消单个文件（替换 Set 触发响应式） */
function toggle(name: string, checked: boolean): void {
  const next = new Set(selected.value)
  if (checked) next.add(name)
  else next.delete(name)
  selected.value = next
}

/** 全选/全不选 */
function toggleAll(checked: boolean): void {
  selected.value = checked ? new Set(files.value.map((file) => file.name)) : new Set()
}

/** 反选 */
function invertSelection(): void {
  const next = new Set<string>()
  for (const file of files.value) {
    if (!selected.value.has(file.name)) next.add(file.name)
  }
  selected.value = next
}

/** 恢复规则默认值 */
function resetRules(): void {
  rules.value = createDefaultRules()
}

/**
 * 重新扫描当前目录（保留规则；可选重置会话结果）
 * @param resetSession 是否清空本次执行结果与撤销记录（切换目录时使用）
 */
async function refreshFiles(resetSession = false): Promise<void> {
  if (dir.value === '') return
  scanning.value = true
  error.value = null
  try {
    const result = await scan(dir.value)
    files.value = result.files
    truncated.value = result.truncated
    selected.value = new Set(result.files.map((file) => file.name))
    notice.value = ''
    if (resetSession) {
      failures.value = []
      lastRenamed.value = []
      doneCount.value = 0
    }
  } catch (err) {
    showError(err)
  } finally {
    scanning.value = false
  }
}

/** 切换目录并记忆（取消选择保持原值） */
async function chooseDir(): Promise<void> {
  error.value = null
  try {
    const picked = await window.lumin.pickDirectory('选择要重命名的文件夹')
    if (picked === null) return
    dir.value = picked
    await setDir(picked)
    await refreshFiles(true)
  } catch (err) {
    showError(err)
  }
}

function onEvent(event: TaskEvent): void {
  if (event.taskId !== currentTaskId) return
  if (event.kind === 'progress') {
    progress.value = { current: event.current, total: event.total, message: event.message }
    return
  }
  if (event.kind === 'log') return
  detach()
  phase.value = 'idle'
  progress.value = null
  if (event.kind === 'done') {
    const result = event.result as RenameTaskResult
    doneCount.value = result.renamed.length
    failures.value = result.failures
    if (undoInFlight) lastRenamed.value = []
    else lastRenamed.value = result.renamed
    undoInFlight = false
    void refreshFiles()
    return
  }
  undoInFlight = false
  if (event.error.code === 'CANCELLED' || event.error.code === 'FR_CANCELLED') {
    notice.value = '已取消（已完成的重命名保留）'
    void refreshFiles()
    return
  }
  error.value = event.error
  errorDetail.value = event.error.detail ?? ''
}

/**
 * 提交改名任务
 * @param kind apply = 按预览执行；undo = 反向恢复最近一次成功批次
 */
async function runTask(kind: 'apply' | 'undo'): Promise<void> {
  error.value = null
  errorDetail.value = ''
  notice.value = ''
  failures.value = []
  const pairs =
    kind === 'apply'
      ? okEntries.value.map((entry) => ({ from: entry.from, to: entry.to }))
      : lastRenamed.value
          .slice()
          .reverse()
          .map((pair) => ({ from: pair.to, to: pair.from }))
  if (pairs.length === 0) {
    error.value = {
      code: 'FR_NO_FILES',
      message: kind === 'apply' ? '没有可执行的重命名，请检查勾选与规则' : '没有可撤销的重命名'
    }
    return
  }
  phase.value = 'running'
  progress.value = { current: 0, total: pairs.length }
  undoInFlight = kind === 'undo'
  try {
    const { taskId } = await (kind === 'apply'
      ? apply({ dir: dir.value, pairs })
      : undo({ dir: dir.value, pairs }))
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    undoInFlight = false
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

/** 报错态重试：目录类错误重新扫描，改名类错误重跑当前任务 */
function retry(): void {
  const code = error.value?.code
  error.value = null
  errorDetail.value = ''
  if (code === 'FR_RENAME_FAILED' && lastRenamed.value.length === 0 && okEntries.value.length > 0) {
    void runTask('apply')
    return
  }
  void refreshFiles()
}

/** 预览行状态标签 */
function statusLabel(entry: PlanEntry): string {
  if (entry.status === 'ok') return '将改名'
  if (entry.status === 'conflict') return '冲突'
  return '跳过'
}

onMounted(() => {
  void config()
    .then((result) => {
      if (result.lastDir === null) return
      dir.value = result.lastDir
      return refreshFiles(true)
    })
    .catch((err) => showError(err))
})

onUnmounted(detach)
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">批量重命名</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        对文件夹内文件按规则批量改名（不递归、不含子文件夹）
      </p>
    </div>

    <!-- 目录选择 -->
    <div class="flex items-center gap-3">
      <NText depth="2" class="w-14 text-sm">目录</NText>
      <NInput :value="dir" readonly placeholder="请选择要处理的文件夹" class="flex-1" />
      <NButton :disabled="phase === 'running' || scanning" @click="chooseDir">
        <FolderOpen class="mr-1 h-3.5 w-3.5" />选择
      </NButton>
      <NButton
        v-if="dir !== ''"
        :disabled="phase === 'running' || scanning"
        @click="refreshFiles()"
      >
        重新扫描
      </NButton>
    </div>

    <!-- 空态：未选目录 / 目录为空 -->
    <NEmpty v-if="dir === ''" description="选择一个文件夹开始批量重命名" />
    <NEmpty v-else-if="files.length === 0 && !scanning" description="目录内没有可重命名的文件">
      <template #extra>
        <NButton size="small" @click="chooseDir">换个目录</NButton>
      </template>
    </NEmpty>
    <NText v-if="scanning" depth="3" class="text-xs">读取目录中…</NText>

    <!-- 规则区标题（作用顺序：删除字符 → 查找替换 → 大小写 → 序号 → 日期 → 扩展名） -->
    <div class="flex items-center justify-between">
      <NText depth="2" class="text-sm font-medium">规则（按作用顺序叠加）</NText>
      <NButton size="tiny" quaternary :disabled="phase === 'running'" @click="resetRules">
        重置规则
      </NButton>
    </div>

    <!-- 规则卡片 -->
    <div class="flex flex-col gap-2">
      <!-- 1. 删除字符 -->
      <div
        class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] p-3"
      >
        <div class="flex items-center gap-2">
          <span class="w-20 text-sm font-medium">删除字符</span>
          <NCheckbox v-model:checked="rules.delete.enabled" :disabled="phase === 'running'">
            启用
          </NCheckbox>
        </div>
        <div v-if="rules.delete.enabled" class="flex items-center gap-2 text-sm">
          <span class="text-[var(--lumin-color-text-secondary)]">从第</span>
          <NInputNumber
            v-model:value="rules.delete.from"
            :min="1"
            :max="255"
            :disabled="phase === 'running'"
            class="w-24"
          />
          <span class="text-[var(--lumin-color-text-secondary)]">个字符起删除</span>
          <NInputNumber
            v-model:value="rules.delete.count"
            :min="0"
            :max="255"
            :disabled="phase === 'running'"
            class="w-24"
          />
          <span class="text-[var(--lumin-color-text-secondary)]">个（按码点计）</span>
        </div>
      </div>

      <!-- 2. 查找替换 -->
      <div
        class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] p-3"
      >
        <div class="flex items-center gap-2">
          <span class="w-20 text-sm font-medium">查找替换</span>
          <NCheckbox v-model:checked="rules.findReplace.enabled" :disabled="phase === 'running'">
            启用
          </NCheckbox>
        </div>
        <template v-if="rules.findReplace.enabled">
          <div class="flex items-center gap-2">
            <NInput
              v-model:value="rules.findReplace.find"
              placeholder="查找内容"
              :disabled="phase === 'running'"
              class="flex-1"
            />
            <NInput
              v-model:value="rules.findReplace.replace"
              placeholder="替换为（可空 = 删除）"
              :disabled="phase === 'running'"
              class="flex-1"
            />
          </div>
          <div class="flex items-center gap-4">
            <NCheckbox v-model:checked="rules.findReplace.isRegex" :disabled="phase === 'running'">
              正则（支持 $1–$9）
            </NCheckbox>
            <NCheckbox
              v-model:checked="rules.findReplace.caseSensitive"
              :disabled="phase === 'running'"
            >
              区分大小写
            </NCheckbox>
          </div>
        </template>
      </div>

      <!-- 3. 大小写 -->
      <div
        class="flex items-center gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] p-3"
      >
        <span class="w-20 text-sm font-medium">大小写</span>
        <select
          v-model="rules.caseMode"
          :disabled="phase === 'running'"
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
        >
          <option value="none">不改变</option>
          <option value="lower">全部小写</option>
          <option value="upper">全部大写</option>
          <option value="capitalize">首字母大写</option>
        </select>
      </div>

      <!-- 4. 序号 -->
      <div
        class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] p-3"
      >
        <div class="flex items-center gap-2">
          <span class="w-20 text-sm font-medium">序号</span>
          <NCheckbox v-model:checked="rules.index.enabled" :disabled="phase === 'running'">
            启用
          </NCheckbox>
        </div>
        <div v-if="rules.index.enabled" class="flex flex-wrap items-center gap-2 text-sm">
          <select
            v-model="rules.index.position"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option value="prefix">前缀</option>
            <option value="suffix">后缀</option>
          </select>
          <span class="text-[var(--lumin-color-text-secondary)]">起始</span>
          <NInputNumber
            v-model:value="rules.index.start"
            :min="0"
            :max="999999"
            :disabled="phase === 'running'"
            class="w-28"
          />
          <span class="text-[var(--lumin-color-text-secondary)]">位数</span>
          <NInputNumber
            v-model:value="rules.index.digits"
            :min="1"
            :max="8"
            :disabled="phase === 'running'"
            class="w-20"
          />
          <span class="text-[var(--lumin-color-text-secondary)]">分隔符</span>
          <select
            v-model="rules.index.separator"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option value="-">-</option>
            <option value="_">_</option>
            <option value=".">.</option>
            <option value="">无</option>
          </select>
        </div>
      </div>

      <!-- 5. 日期 -->
      <div
        class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] p-3"
      >
        <div class="flex items-center gap-2">
          <span class="w-20 text-sm font-medium">日期</span>
          <NCheckbox v-model:checked="rules.date.enabled" :disabled="phase === 'running'">
            启用
          </NCheckbox>
        </div>
        <div v-if="rules.date.enabled" class="flex flex-wrap items-center gap-2 text-sm">
          <select
            v-model="rules.date.position"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option value="prefix">前缀</option>
            <option value="suffix">后缀</option>
          </select>
          <select
            v-model="rules.date.format"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option value="YYYYMMDD">20261118</option>
            <option value="YYYY-MM-DD">2026-11-18</option>
            <option value="YYMMDD-HHmmss">261118-093000</option>
          </select>
          <select
            v-model="rules.date.source"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option value="mtime">文件修改时间</option>
            <option value="now">当前时间</option>
          </select>
        </div>
      </div>

      <!-- 6. 扩展名 -->
      <div
        class="flex flex-wrap items-center gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] p-3"
      >
        <span class="w-20 text-sm font-medium">扩展名</span>
        <select
          v-model="rules.extension.mode"
          :disabled="phase === 'running'"
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
        >
          <option value="keep">保持原样</option>
          <option value="lower">转小写</option>
          <option value="custom">统一改为</option>
        </select>
        <template v-if="rules.extension.mode === 'custom'">
          <span class="text-[var(--lumin-color-text-secondary)]">.</span>
          <NInput
            v-model:value="rules.extension.custom"
            placeholder="如 jpg（不含点）"
            :disabled="phase === 'running'"
            class="w-32"
          />
        </template>
      </div>
    </div>

    <!-- 预览列表（勾选参与本次改名） -->
    <template v-if="files.length > 0">
      <div class="flex items-center justify-between">
        <NText depth="2" class="text-sm font-medium">
          已勾选 {{ selected.size }} / 共 {{ files.length }} 个 · 将改名 {{ okEntries.length }} 个
          <template v-if="plan.conflictCount > 0"> · 冲突 {{ plan.conflictCount }} 个</template>
        </NText>
        <div class="flex items-center gap-2">
          <NButton
            size="tiny"
            quaternary
            :disabled="phase === 'running'"
            @click="toggleAll(!allSelected)"
          >
            {{ allSelected ? '全不选' : '全选' }}
          </NButton>
          <NButton size="tiny" quaternary :disabled="phase === 'running'" @click="invertSelection">
            反选
          </NButton>
        </div>
      </div>
      <NText v-if="truncated" type="warning" class="text-xs">
        目录文件超过 5000 个，仅显示前 5000 个
      </NText>
      <NText v-if="plan.ruleError !== null" type="warning" class="text-xs">
        {{ plan.ruleError }}
      </NText>
      <div class="flex max-h-80 flex-col gap-1 overflow-y-auto">
        <div
          v-for="entry in plan.entries"
          :key="entry.from"
          class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-1.5"
        >
          <NCheckbox
            :checked="selected.has(entry.from)"
            :disabled="phase === 'running'"
            @update:checked="toggle(entry.from, $event)"
          />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm">{{ entry.from }}</div>
            <div class="truncate text-xs text-[var(--lumin-color-text-secondary)]">
              {{ metaOf(entry.from) }} · → {{ entry.to }}
              <template v-if="entry.reason !== undefined"> · {{ entry.reason }}</template>
            </div>
          </div>
          <NTag
            size="tiny"
            :bordered="false"
            :type="
              entry.status === 'ok' ? 'success' : entry.status === 'conflict' ? 'error' : 'default'
            "
          >
            {{ statusLabel(entry) }}
          </NTag>
        </div>
      </div>
    </template>

    <!-- 操作区 -->
    <div class="flex items-center gap-2">
      <NButton
        type="primary"
        :disabled="
          phase !== 'idle' ||
          okEntries.length === 0 ||
          plan.conflictCount > 0 ||
          plan.ruleError !== null
        "
        @click="runTask('apply')"
      >
        执行重命名（{{ okEntries.length }}）
      </NButton>
      <NButton v-if="lastRenamed.length > 0" :disabled="phase !== 'idle'" @click="runTask('undo')">
        <RotateCcw class="mr-1 h-3.5 w-3.5" />撤销本次（{{ lastRenamed.length }}）
      </NButton>
    </div>

    <!-- 加载态：进度可见 + 可取消（R4 强制） -->
    <TaskProgress
      v-if="phase === 'running' && progress !== null"
      :message="
        progress.message !== '' && progress.message !== undefined
          ? `重命名中 · ${progress.message}`
          : '重命名中…'
      "
      :current="progress.current"
      :total="progress.total"
      @cancel="cancelTask"
    />

    <!-- 结果区：成功计数 + 逐条失败 -->
    <div v-if="doneCount > 0 || failures.length > 0 || notice !== ''" class="flex flex-col gap-2">
      <NText v-if="doneCount > 0" depth="2" class="text-sm font-medium">
        已重命名 {{ doneCount }} 个<template v-if="failures.length > 0"
          >，失败 {{ failures.length }} 个</template
        >
      </NText>
      <NText v-if="notice !== ''" depth="3" class="text-sm">{{ notice }}</NText>
      <div
        v-for="fail in failures"
        :key="fail.from"
        class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-error, #e88080)] px-3 py-1.5"
      >
        <NText type="error" class="block truncate text-sm">{{ fail.from }}</NText>
        <NText depth="3" class="block text-xs">
          {{ errorMessage(fail.code)
          }}<template v-if="fail.message !== ''"> （{{ fail.message }}）</template>
        </NText>
      </div>
    </div>

    <!-- 报错态：结构化错误码 → 中文文案 + 重试/详情 -->
    <div v-if="error !== null" class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <NText type="error" class="text-sm">
          <CircleAlert class="mr-1 inline h-3.5 w-3.5" />{{ error.message }}
        </NText>
        <NButton v-if="isRetryable(error.code) || dir !== ''" size="tiny" quaternary @click="retry">
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

    <NText v-if="dir !== ''" depth="3" class="text-xs">
      <X
        class="mr-1 inline h-3 w-3"
      />仅处理当前文件夹内的普通文件，子文件夹与隐藏规则外的项不受影响
    </NText>
  </div>
</template>
