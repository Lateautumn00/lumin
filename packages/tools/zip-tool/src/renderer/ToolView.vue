<script setup lang="ts">
// 压缩包工具主视图（M25）
// 作者：cuilanchao · 修改时间：2026-11-20
// 三态强制（空态双 Tab 引导/加载条目进度可取消/报错码 + 详情）；
// 打包保留相对结构、产物冲突递增；解压做 zip slip 防护与同名重命名/跳过（spec §3）
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, NEmpty, NInput, NSelect, NText, NTabPane, NTabs } from 'naive-ui'
import { Archive, CircleAlert, FolderOpen, X } from '@lucide/vue'
import {
  fileNameOf,
  formatBytes,
  toStructuredError,
  type StructuredError,
  type TaskEvent
} from '@lumin/shared'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import DropZone from '@lumin/ui/DropZone.vue'
import {
  defaultArchiveName,
  defaultTargetDir,
  isZipFileName,
  parentDirectory,
  partitionSourcePaths
} from '../contract'
import { isRetryable } from '../errors'
import {
  MAX_SOURCES,
  type ConflictPolicy,
  type ConfigResult,
  type PackResult,
  type UnpackResult
} from '../schema'
import { config, pack, setConfig, unpack } from './client'

type Mode = 'pack' | 'unpack'
type TaskKind = Mode

const activeTab = ref<Mode>('pack')

// —— 打包 ——
const sources = ref<string[]>([])
const outputDir = ref('')
const outputName = ref('')

// —— 解压 ——
const archive = ref('')
const targetDir = ref('')
const conflict = ref<ConflictPolicy>('rename')

// —— 任务与结果 ——
const phase = ref<'idle' | 'running'>('idle')
const progress = ref<{ current: number; total?: number; message?: string; stage?: string } | null>(null)
const runningKind = ref<TaskKind>('pack')
const packResult = ref<PackResult | null>(null)
const unpackResult = ref<UnpackResult | null>(null)
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')
const notice = ref('')
const invalidHint = ref('')

let unsubscribe: (() => void) | null = null
let currentTaskId = ''
/** invoke 返回 taskId 前已到达的事件（小任务可能瞬间完成，先订阅后提交） */
let pendingEvents: TaskEvent[] = []

const busy = computed(() => phase.value !== 'idle')
const canPack = computed(
  () =>
    sources.value.length > 0 &&
    outputDir.value !== '' &&
    isZipFileName(outputName.value) &&
    !busy.value
)
const canUnpack = computed(() => archive.value !== '' && targetDir.value !== '' && !busy.value)

const conflictOptions: { label: string; value: ConflictPolicy }[] = [
  { label: '自动重命名（推荐）', value: 'rename' },
  { label: '跳过同名文件', value: 'skip' }
]

const progressMessage = computed(() => {
  const current = progress.value
  if (current === null) return ''
  const kindText = current.stage === 'unpack' ? '解压' : '打包'
  const total = current.total ?? 0
  const name = (current.message ?? '').slice(0, 60)
  const tail = name === '' ? '' : ` · ${name}`
  return `正在${kindText} · 已完成 ${current.current} / ${total} 个条目${tail}`
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

/** 保存全部记忆（失败不打断交互） */
async function persist(): Promise<void> {
  try {
    await setConfig({
      mode: activeTab.value,
      packSources: sources.value,
      outputDir: outputDir.value === '' ? null : outputDir.value,
      outputName: outputName.value === '' ? null : outputName.value,
      archive: archive.value === '' ? null : archive.value,
      targetDir: targetDir.value === '' ? null : targetDir.value,
      conflict: conflict.value
    })
  } catch {
    // 记忆失败不影响本次操作
  }
}

/** 加入打包源（大小写不敏感去重、上限 200） */
function addSources(paths: string[]): void {
  invalidHint.value = ''
  const merged = partitionSourcePaths([...sources.value, ...paths])
  if (merged.length > MAX_SOURCES) {
    invalidHint.value = `最多添加 ${MAX_SOURCES} 个源`
    sources.value = merged.slice(0, MAX_SOURCES)
  } else {
    sources.value = merged
  }
  if (outputDir.value === '' && sources.value.length > 0) {
    outputDir.value = parentDirectory(sources.value[0] ?? '')
  }
  if (outputName.value === '') {
    outputName.value = defaultArchiveName(sources.value)
  }
  packResult.value = null
  error.value = null
  void persist()
}

function removeSource(index: number): void {
  sources.value = sources.value.filter((_, position) => position !== index)
  packResult.value = null
  void persist()
}

/** DropZone 选择（多个文件逐个触发） */
function selectFile(payload: { path: string }): void {
  addSources([payload.path])
}

/** DropZone 选择压缩包 */
function onArchiveSelect(payload: { path: string }): void {
  selectArchive(payload.path)
}

async function addFolder(): Promise<void> {
  error.value = null
  try {
    const picked = await window.lumin.pickDirectory('选择要打包的文件夹')
    if (picked === null) return
    addSources([picked])
  } catch (err) {
    showError(err)
  }
}

async function chooseOutputDir(): Promise<void> {
  error.value = null
  try {
    const picked = await window.lumin.pickDirectory('选择压缩包输出目录')
    if (picked === null) return
    outputDir.value = picked
    packResult.value = null
    await persist()
  } catch (err) {
    showError(err)
  }
}

/** 选择解压压缩包（拖拽入口） */
function selectArchive(path: string): void {
  if (!isZipFileName(fileNameOf(path))) {
    invalidHint.value = '仅支持 .zip 压缩包'
    return
  }
  invalidHint.value = ''
  detach()
  archive.value = path
  if (targetDir.value === '') targetDir.value = defaultTargetDir(path)
  unpackResult.value = null
  notice.value = ''
  void persist()
}

async function chooseTargetDir(): Promise<void> {
  error.value = null
  try {
    const picked = await window.lumin.pickDirectory('选择解压目标目录')
    if (picked === null) return
    targetDir.value = picked
    unpackResult.value = null
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
      message: event.message,
      stage: event.stage
    }
    return
  }
  if (event.kind === 'log') return
  detach()
  phase.value = 'idle'
  progress.value = null
  if (event.kind === 'done') {
    if (runningKind.value === 'pack') packResult.value = event.result as PackResult
    else unpackResult.value = event.result as UnpackResult
    return
  }
  if (event.error.code === 'CANCELLED') {
    notice.value = '已取消'
    return
  }
  error.value = event.error
  errorDetail.value = event.error.detail ?? ''
}

/** 提交任务（kind 决定通道与结果槽位） */
async function start(kind: TaskKind): Promise<void> {
  if (kind === 'pack' ? !canPack.value : !canUnpack.value) return
  detach()
  error.value = null
  errorDetail.value = ''
  notice.value = ''
  invalidHint.value = ''
  runningKind.value = kind
  if (kind === 'pack') packResult.value = null
  else unpackResult.value = null
  phase.value = 'running'
  progress.value = { current: 0, total: 0, stage: kind }
  pendingEvents = []
  unsubscribe = window.lumin.onTaskEvent(onEvent)
  try {
    await persist()
    const { taskId } =
      kind === 'pack'
        ? await pack({
            sources: sources.value,
            outputDir: outputDir.value,
            outputName: outputName.value
          })
        : await unpack({
            archive: archive.value,
            targetDir: targetDir.value,
            conflict: conflict.value
          })
    currentTaskId = taskId
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

function retry(): void {
  error.value = null
  errorDetail.value = ''
  void start(runningKind.value)
}

function reveal(path: string): void {
  if (path === '') return
  void window.lumin.revealPath(path).catch(showError)
}

watch(activeTab, () => {
  error.value = null
  errorDetail.value = ''
  notice.value = ''
  invalidHint.value = ''
  void persist()
})

watch(conflict, () => {
  void persist()
})

onMounted(() => {
  void config()
    .then((saved: ConfigResult) => {
      activeTab.value = saved.mode
      sources.value = saved.packSources
      outputDir.value = saved.outputDir ?? ''
      outputName.value = saved.outputName ?? defaultArchiveName(saved.packSources)
      archive.value = saved.archive ?? ''
      targetDir.value = saved.targetDir ?? ''
      conflict.value = saved.conflict
      if (targetDir.value === '' && archive.value !== '') {
        targetDir.value = defaultTargetDir(archive.value)
      }
    })
    .catch(() => undefined)
})

onUnmounted(detach)
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">压缩包工具</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        打包文件或文件夹为 ZIP，或把 ZIP 解压到指定目录；解压不覆盖已有文件。
      </p>
    </div>

    <!-- 标签必须走 #tab 插槽：当前 naive-ui 构建下自闭合 pane 的 tab 文本不会渲染 -->
    <NTabs v-model:value="activeTab" type="line">
      <NTabPane name="pack" :disabled="busy">
        <template #tab>打包</template>
      </NTabPane>
      <NTabPane name="unpack" :disabled="busy">
        <template #tab>解压</template>
      </NTabPane>
    </NTabs>

    <p v-if="invalidHint !== ''" class="text-xs text-[var(--lumin-color-warning,#f0a020)]">
      {{ invalidHint }}
    </p>

    <!-- 打包 -->
    <template v-if="activeTab === 'pack'">
      <NEmpty
        v-if="sources.length === 0 && phase === 'idle' && error === null"
        description="添加文件或文件夹后点击「开始打包」；目录会保留相对结构"
      />

      <DropZone
        :hint="sources.length === 0 ? '拖入文件（可多选），或点击选择' : '继续添加文件'"
        multiple
        :disabled="busy"
        @select="selectFile"
        @invalid="invalidHint = $event"
      />

      <div class="flex flex-wrap items-center gap-2">
        <NButton :disabled="busy" @click="addFolder">
          <FolderOpen class="mr-1 h-3.5 w-3.5" />添加文件夹
        </NButton>
        <NText depth="3" class="text-xs">共 {{ sources.length }} 项（上限 {{ MAX_SOURCES }}）</NText>
      </div>

      <div
        v-if="sources.length > 0"
        class="flex flex-col rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)]"
      >
        <div
          v-for="(path, index) in sources"
          :key="path"
          class="flex items-center gap-2 border-b border-[var(--lumin-color-border)] px-3 py-2 last:border-b-0"
        >
          <Archive class="h-3.5 w-3.5 shrink-0 text-[var(--lumin-color-text-secondary)]" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm" :title="path">{{ fileNameOf(path) }}</div>
            <div class="truncate text-xs text-[var(--lumin-color-text-secondary)]" :title="path">
              {{ path }}
            </div>
          </div>
          <NButton
            size="tiny"
            quaternary
            aria-label="移除"
            :disabled="busy"
            @click="removeSource(index)"
          >
            <X class="h-3.5 w-3.5" />
          </NButton>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <NInput :value="outputDir" placeholder="选择输出目录" readonly :disabled="busy" />
          <NButton :disabled="busy" @click="chooseOutputDir">
            <FolderOpen class="mr-1 h-3.5 w-3.5" />输出目录
          </NButton>
        </div>
        <NInput
          v-model:value="outputName"
          placeholder="压缩包文件名（.zip）"
          :disabled="busy"
          class="max-w-80"
        />
        <div class="flex flex-wrap items-center gap-3">
          <NButton type="primary" :disabled="!canPack" @click="start('pack')">开始打包</NButton>
          <NText v-if="outputName !== '' && !isZipFileName(outputName)" type="warning" class="text-xs">
            文件名需以 .zip 结尾
          </NText>
        </div>
      </div>
    </template>

    <!-- 解压 -->
    <template v-else>
      <NEmpty
        v-if="archive === '' && phase === 'idle' && error === null"
        description="拖入 .zip 压缩包或点击选择；解压不会覆盖同目录已有文件"
      />

      <DropZone
        accept=".zip"
        :hint="archive === '' ? '拖入 .zip 压缩包，或点击选择' : '重新选择压缩包'"
        :disabled="busy"
        @select="onArchiveSelect"
        @invalid="invalidHint = $event"
      />

      <div v-if="archive !== ''" class="flex flex-col gap-2">
        <NInput :value="archive" placeholder="压缩包" readonly :disabled="busy" />
        <div class="flex items-center gap-2">
          <NInput :value="targetDir" placeholder="选择解压目标目录" readonly :disabled="busy" />
          <NButton :disabled="busy" @click="chooseTargetDir">
            <FolderOpen class="mr-1 h-3.5 w-3.5" />目标目录
          </NButton>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <NSelect
            v-model:value="conflict"
            :options="conflictOptions"
            class="w-52"
            :disabled="busy"
          />
          <NButton type="primary" :disabled="!canUnpack" @click="start('unpack')">
            开始解压
          </NButton>
        </div>
      </div>
    </template>

    <!-- 加载态：进度可见 + 可取消（R4 强制） -->
    <TaskProgress
      v-if="phase !== 'idle' && progress !== null"
      :message="progressMessage"
      :current="progress.current"
      :total="progress.total"
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
        <NButton v-if="isRetryable(error.code) && !busy" size="tiny" quaternary @click="retry">
          重试
        </NButton>
      </div>
      <details v-if="errorDetail !== ''">
        <summary class="cursor-pointer text-xs text-[var(--lumin-color-text-secondary)]">详情</summary>
        <NText depth="3" class="block break-all text-xs">{{ errorDetail }}</NText>
      </details>
    </div>

    <!-- 打包结果 -->
    <div
      v-if="packResult !== null"
      class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] p-3"
    >
      <div class="flex items-center justify-between gap-2">
        <NText class="break-all text-sm">已生成 {{ packResult.outputZip }}</NText>
        <NButton size="small" @click="reveal(packResult.outputZip)">定位产物</NButton>
      </div>
      <NText depth="3" class="text-xs">
        文件 {{ packResult.files }} · 目录 {{ packResult.dirs }} ·
        {{ formatBytes(packResult.bytes) }} · 耗时 {{ (packResult.elapsedMs / 1000).toFixed(1) }}s
      </NText>
    </div>

    <!-- 解压结果 -->
    <div
      v-if="unpackResult !== null"
      class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] p-3"
    >
      <div class="flex items-center justify-between gap-2">
        <NText class="break-all text-sm">已解压到 {{ unpackResult.targetDir }}</NText>
        <NButton size="small" @click="reveal(unpackResult.targetDir)">打开目标目录</NButton>
      </div>
      <NText depth="3" class="text-xs">
        文件 {{ unpackResult.files }} · 目录 {{ unpackResult.dirs }} ·
        {{ formatBytes(unpackResult.bytes) }} · 跳过 {{ unpackResult.skipped }} · 重命名
        {{ unpackResult.renamed }} · 耗时 {{ (unpackResult.elapsedMs / 1000).toFixed(1) }}s
      </NText>
      <NText v-if="unpackResult.skipped > 0" depth="3" class="text-xs">
        被跳过的条目包含同名文件、路径穿越条目或符号链接，未写入磁盘。
      </NText>
    </div>
  </div>
</template>
