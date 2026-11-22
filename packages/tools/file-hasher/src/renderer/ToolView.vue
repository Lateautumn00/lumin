<script setup lang="ts">
// 文件哈希校验主视图（M13）
// 作者：cuilanchao · 修改时间：2026-11-19
// 三态强制（空拖拽引导/加载进度可取消/报错码 + 详情）、四算法可多选、粘贴期望哈希比对、
// 复制单行/全部 TSV、失败项重试（spec §2/§6）
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NCheckbox, NEmpty, NInput, NText, NTag } from 'naive-ui'
import { CircleAlert, Copy, Hash, RotateCcw, X } from '@lucide/vue'
import { formatBytes, toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { config, hashFiles, setConfig } from './client'
import { errorMessage, isRetryable } from '../errors'
import {
  ALGORITHMS,
  MAX_FILE_BYTES,
  MAX_FILES,
  type Algorithm,
  type HashFileResult,
  type HashResult
} from '../schema'
import {
  algorithmLabel,
  fileNameOf,
  formatTime,
  matchesExpected,
  normalizeAlgorithms,
  normalizeExpected,
  toTsv
} from '../contract'

/** 已选文件（path 去重键） */
interface PickedFile {
  path: string
  name: string
  size: number
}

// —— 输入 ——
const picked = ref<PickedFile[]>([])
const algorithms = ref<Algorithm[]>(['sha256'])
const expectedRaw = ref('')

// —— 任务与结果 ——
const phase = ref<'idle' | 'hashing'>('idle')
const progress = ref<{
  current: number
  total?: number
  stage?: string
  message?: string
} | null>(null)
const result = ref<HashResult | null>(null)
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')
const notice = ref('')

let unsubscribe: (() => void) | null = null
let currentTaskId = ''
/** invoke 返回 taskId 前已到达的事件（小文件可能瞬间完成，先订阅后提交） */
let pendingEvents: TaskEvent[] = []

const busy = computed(() => phase.value !== 'idle')
const results = computed<HashFileResult[]>(() => result.value?.results ?? [])
const failedResults = computed(() => results.value.filter((item) => item.status === 'failed'))

/** 期望哈希（非法时 null，输入非空即报格式错误） */
const expected = computed(() => normalizeExpected(expectedRaw.value))
const expectedInvalid = computed(() => expectedRaw.value.trim() !== '' && expected.value === null)
/** 命中的结果路径集合（无期望哈希时空） */
const matchedPaths = computed(() => {
  const current = expected.value
  if (current === null) return new Set<string>()
  return new Set(
    results.value.filter((item) => matchesExpected(item, current)).map((item) => item.path)
  )
})

/** 已选算法是否至少 1 个 */
const hasAlgorithm = computed(() => algorithms.value.length > 0)

/** 结果概览 */
const summary = computed(() => {
  const done = result.value
  if (done === null) return ''
  const seconds = (done.elapsedMs / 1000).toFixed(1)
  return `共 ${done.results.length} 个文件 · 成功 ${done.results.length - done.failedCount} · 失败 ${done.failedCount} · 耗时 ${seconds}s`
})

const progressMessage = computed(() => {
  const current = progress.value
  if (current === null) return ''
  if (current.stage === 'prepare') return '正在读取文件信息…'
  const name = current.message !== undefined && current.message !== '' ? fileNameOf(current.message) : ''
  const bytes =
    current.total !== undefined && current.total > 0
      ? ` · ${formatBytes(current.current)} / ${formatBytes(current.total)}`
      : ''
  return `正在计算${name !== '' ? ` · ${name}` : ''}${bytes}`
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

/** 追加文件（去重、上限、单文件体积守卫） */
function addFile(payload: { file: File; path: string }): void {
  if (picked.value.some((item) => item.path === payload.path)) return
  if (payload.file.size > MAX_FILE_BYTES) {
    notice.value = `${payload.file.name} 超过单文件 20 GB 上限，已忽略`
    return
  }
  if (picked.value.length >= MAX_FILES) {
    notice.value = `单次最多 ${MAX_FILES} 个文件，超出部分已忽略`
    return
  }
  picked.value = [
    ...picked.value,
    { path: payload.path, name: payload.file.name, size: payload.file.size }
  ]
  notice.value = ''
}

function removeFile(path: string): void {
  picked.value = picked.value.filter((item) => item.path !== path)
}

function clearAll(): void {
  picked.value = []
  result.value = null
  notice.value = ''
  progress.value = null
}

function toggleAlgorithm(algorithm: Algorithm, checked: boolean): void {
  const selected = checked
    ? normalizeAlgorithms([...algorithms.value, algorithm])
    : algorithms.value.filter((value) => value !== algorithm)
  algorithms.value = selected
  if (selected.length === 0) notice.value = '至少选择一种算法'
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
    const done = event.result as HashResult
    result.value = done
    notice.value =
      done.failedCount > 0
        ? `计算完成：${done.results.length - done.failedCount} 个成功、${done.failedCount} 个失败`
        : `计算完成：${done.results.length} 个文件`
    return
  }
  if (event.error.code === 'CANCELLED') {
    notice.value = '已取消计算'
    return
  }
  error.value = event.error
  errorDetail.value = event.error.detail ?? ''
}

/** 提交哈希任务（paths 缺省取已选全部；失败项重试传失败路径） */
async function start(paths: string[] = picked.value.map((item) => item.path)): Promise<void> {
  if (paths.length === 0) return
  if (!hasAlgorithm.value) {
    notice.value = '请至少选择一种算法'
    return
  }
  error.value = null
  errorDetail.value = ''
  notice.value = ''
  phase.value = 'hashing'
  progress.value = { current: 0, stage: 'prepare' }
  pendingEvents = []
  unsubscribe = window.lumin.onTaskEvent(onEvent)
  // 复制为普通数组：Vue 响应式代理无法通过 IPC 结构化克隆
  const selectedAlgorithms = [...algorithms.value]
  try {
    await setConfig({ algorithms: selectedAlgorithms })
    const { taskId } = await hashFiles({ paths: [...paths], algorithms: selectedAlgorithms })
    currentTaskId = taskId
    // 回放提交期间已到达的事件（小文件瞬间完成时 done 早于 invoke 返回）
    const replay = pendingEvents.splice(0)
    for (const event of replay) {
      if (event.taskId === taskId) onEvent(event)
    }
  } catch (err) {
    showError(err)
  }
}

/** 失败项重试：只重算失败路径 */
function retryFailed(): void {
  const paths = failedResults.value.map((item) => item.path)
  if (paths.length === 0) return
  void start(paths)
}

async function cancelTask(): Promise<void> {
  if (currentTaskId === '') return
  try {
    await window.lumin.invoke('lumin:task:cancel', { taskId: currentTaskId })
  } catch (err) {
    showError(err)
  }
}

/** 复制文本（优先 Clipboard API，失败降级 execCommand） */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    notice.value = '已复制到剪贴板'
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    notice.value = ok ? '已复制到剪贴板' : '复制失败，请手动选择文本'
  }
}

function copyAll(): void {
  void copyText(toTsv(results.value, algorithms.value))
}

function copyRow(item: HashFileResult): void {
  void copyText(toTsv([item], algorithms.value))
}

function retry(): void {
  error.value = null
  errorDetail.value = ''
  void start()
}

onMounted(() => {
  void config()
    .then((saved) => {
      const normalized = normalizeAlgorithms(saved.algorithms)
      if (normalized.length > 0) algorithms.value = normalized
    })
    .catch(() => undefined)
})

onUnmounted(detach)
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">文件哈希校验</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        批量选择文件计算 MD5 / SHA-1 / SHA-256 / SHA-512；粘贴期望哈希即可自动比对完整性，结果可复制。
      </p>
    </div>

    <!-- 输入区：拖拽/多选（任务中禁用） -->
    <DropZone
      multiple
      :disabled="busy"
      hint="拖拽文件到此处，或点击选择（可多选）"
      @select="addFile"
      @invalid="notice = $event"
    />

    <!-- 已选列表 -->
    <div v-if="picked.length > 0" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <NText depth="3" class="text-xs">已选 {{ picked.length }} / {{ MAX_FILES }} 个文件</NText>
        <NButton size="tiny" quaternary :disabled="busy" @click="clearAll">清空</NButton>
      </div>
      <div class="max-h-48 overflow-y-auto rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)]">
        <div
          v-for="item in picked"
          :key="item.path"
          class="flex items-center gap-2 border-b border-[var(--lumin-color-border, #e0e0e6)] px-3 py-1.5 last:border-b-0"
        >
          <span class="min-w-0 flex-1 truncate text-sm" :title="item.path">{{ item.name }}</span>
          <NText depth="3" class="text-xs">{{ formatBytes(item.size) }}</NText>
          <NButton size="tiny" quaternary :disabled="busy" @click="removeFile(item.path)">
            <X class="h-3.5 w-3.5" aria-label="移除" />
          </NButton>
        </div>
      </div>
    </div>

    <!-- 算法勾选 -->
    <div class="flex flex-wrap items-center gap-4">
      <NText depth="2" class="text-sm">算法</NText>
      <NCheckbox
        v-for="algorithm in ALGORITHMS"
        :key="algorithm"
        :checked="algorithms.includes(algorithm)"
        :disabled="busy"
        @update:checked="toggleAlgorithm(algorithm, $event)"
      >
        {{ algorithmLabel(algorithm) }}
      </NCheckbox>
      <NText depth="3" class="text-xs">默认仅 SHA-256；可多选，一次读取同时计算</NText>
    </div>

    <!-- 操作区 -->
    <div class="flex items-center gap-2">
      <NButton
        type="primary"
        :disabled="busy || picked.length === 0 || !hasAlgorithm"
        @click="start()"
      >
        <Hash class="mr-1 h-3.5 w-3.5" />开始校验
      </NButton>
      <NButton
        v-if="failedResults.length > 0 && !busy"
        :disabled="!hasAlgorithm"
        @click="retryFailed"
      >
        <RotateCcw class="mr-1 h-3.5 w-3.5" />重试失败项（{{ failedResults.length }}）
      </NButton>
    </div>

    <!-- 空态：未添加文件 / 已添加未开始 -->
    <NEmpty
      v-if="picked.length === 0 && result === null"
      description="添加文件后点击「开始校验」，即可获得哈希值"
    />
    <NEmpty
      v-else-if="picked.length > 0 && result === null && phase === 'idle'"
      description="点击「开始校验」计算所选文件的哈希"
    />

    <!-- 加载态：进度可见 + 可取消（R4 强制） -->
    <TaskProgress
      v-if="phase !== 'idle' && progress !== null"
      :message="progressMessage"
      :current="progress.current"
      :total="progress.total"
      @cancel="cancelTask"
    />

    <!-- 提示（完成/取消/校验提示） -->
    <NText v-if="notice !== ''" depth="3" class="text-sm">{{ notice }}</NText>

    <!-- 报错态：结构化错误码 → 中文文案 + 重试/详情 -->
    <div v-if="error !== null" class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <NText type="error" class="text-sm">
          <CircleAlert class="mr-1 inline h-3.5 w-3.5" />{{ error.message }}
        </NText>
        <NButton
          v-if="isRetryable(error.code) && picked.length > 0"
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

    <!-- 比对区：粘贴期望哈希 -->
    <div v-if="results.length > 0" class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <NText depth="2" class="w-16 shrink-0 text-sm">期望哈希</NText>
        <NInput
          v-model:value="expectedRaw"
          placeholder="粘贴 MD5 / SHA-1 / SHA-256 / SHA-512，可带 md5: 等前缀"
          :disabled="busy"
          clearable
        />
      </div>
      <NText v-if="expectedInvalid" type="error" class="text-xs">
        格式非法：需为 32/40/64/128 位十六进制，或带 md5: / sha1: / sha256: / sha512: 前缀
      </NText>
      <NText v-else-if="expected !== null" depth="3" class="text-xs">
        按 {{ algorithmLabel(expected.algorithm) }} 比对，命中 {{ matchedPaths.size }} 个文件
      </NText>
    </div>

    <!-- 结果表 -->
    <template v-if="results.length > 0">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <NText class="text-sm font-medium">{{ summary }}</NText>
        <NButton size="small" :disabled="busy" @click="copyAll">
          <Copy class="mr-1 h-3.5 w-3.5" />复制全部
        </NButton>
      </div>

      <div class="overflow-x-auto rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)]">
        <table class="w-full min-w-[42rem] text-left text-sm">
          <thead>
            <tr class="border-b border-[var(--lumin-color-border, #e0e0e6)]">
              <th class="px-3 py-2 font-medium">文件名</th>
              <th class="px-3 py-2 font-medium">大小</th>
              <th class="px-3 py-2 font-medium">修改时间</th>
              <th v-for="algorithm in algorithms" :key="algorithm" class="px-3 py-2 font-medium">
                {{ algorithmLabel(algorithm) }}
              </th>
              <th class="px-3 py-2 font-medium">状态</th>
              <th class="px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in results"
              :key="item.path"
              class="border-b border-[var(--lumin-color-border, #e0e0e6)] last:border-b-0"
              :class="
                matchedPaths.has(item.path)
                  ? 'bg-[var(--lumin-color-primary-soft, #eef4ff)]'
                  : ''
              "
            >
              <td class="max-w-56 px-3 py-2">
                <div class="truncate" :title="item.path">{{ fileNameOf(item.path) }}</div>
                <div class="truncate text-xs text-[var(--lumin-color-text-secondary)]" :title="item.path">
                  {{ item.path }}
                </div>
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-xs">{{ formatBytes(item.size) }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-xs">{{ formatTime(item.mtimeMs) }}</td>
              <td
                v-for="algorithm in algorithms"
                :key="algorithm"
                class="px-3 py-2 font-mono text-xs break-all"
              >
                {{ item.hashes[algorithm] ?? '—' }}
              </td>
              <td class="whitespace-nowrap px-3 py-2">
                <NTag
                  v-if="item.status === 'ok'"
                  size="tiny"
                  :type="matchedPaths.has(item.path) ? 'success' : 'default'"
                  :bordered="false"
                >
                  {{ matchedPaths.has(item.path) ? '匹配' : '成功' }}
                </NTag>
                <NTag v-else size="tiny" type="error" :bordered="false" :title="item.message ?? ''">
                  失败
                </NTag>
                <div
                  v-if="item.status === 'failed' && item.code !== undefined"
                  class="mt-0.5 text-xs text-[var(--lumin-color-text-secondary)]"
                >
                  {{ errorMessage(item.code) }}
                </div>
              </td>
              <td class="whitespace-nowrap px-3 py-2">
                <NButton size="tiny" quaternary @click="copyRow(item)">
                  <Copy class="h-3.5 w-3.5" aria-label="复制本行" />
                </NButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <NText v-if="result !== null && result.failedCount > 0" depth="3" class="text-xs">
        失败项不中断整批：可修复占用/权限后点击「重试失败项」只重算失败文件。
      </NText>
    </template>
  </div>
</template>
