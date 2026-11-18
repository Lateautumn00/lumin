<script setup lang="ts">
// 视频下载工具主视图（M4 P2 完整版）
// 作者：cuilanchao · 修改时间：2026-11-18
// 免责三重呈现（弹窗 + banner；关于页声明在壳层）、三态强制、历史列表（续传/打开文件夹/清空）
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  NButton,
  NCheckbox,
  NEmpty,
  NInput,
  NModal,
  NPopconfirm,
  NSelect,
  NSpace,
  NTag,
  NText
} from 'naive-ui'
import { FolderOpen, RotateCcw, ShieldCheck } from '@lucide/vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { clearHistory, history, markPause, probe, revealPath, start } from './client'
import type { HistoryEntry, Preset, ProbeResult } from '../schema'

/** 免责文案正文（plan §4.5 / spec §0 同源，修改须重走 R8） */
const DISCLAIMER_TEXT =
  '本工具仅用于个人学习、研究与非商业用途的内容备份。您应确保：① 仅下载您拥有合法权利或平台明确允许下载的内容；② 遵守目标平台服务条款与所在地法律法规；③ 不将下载内容用于商业传播、二次分发或任何侵权用途；④ 因使用本工具产生的法律责任由使用者自行承担。本工具不内置任何绕过平台技术限制的能力。'

/** 免责已确认的 settings 键（node.ts 主进程同库存储，扁平键 tools.video-download.*） */
const DISCLAIMER_KEY = 'disclaimerAccepted'

const PRESET_OPTIONS = [
  { label: '最优画质', value: 'best' },
  { label: '1080p', value: '1080p' },
  { label: '仅音频 MP3', value: 'audio-mp3' }
] as const

const STATUS_LABELS: Record<HistoryEntry['status'], string> = {
  RUNNING: '下载中',
  PAUSED: '已暂停',
  DONE: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消'
}

// —— 免责声明（未同意时主功能区置灰） ——
const disclaimerAccepted = ref(false)
const disclaimerVisible = ref(false)
const dontShowAgain = ref(true)

// —— 输入与 probe ——
const url = ref('')
const preset = ref<Preset>('best')
const outputDir = ref('')
const probeInfo = ref<ProbeResult | null>(null)

// —— 任务与历史 ——
const activeTaskId = ref('')
const progress = ref<{ current: number; total?: number; message?: string } | null>(null)
const entries = ref<HistoryEntry[]>([])
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')

const phase = ref<'idle' | 'probing' | 'running'>('idle')
const mainDisabled = computed(() => !disclaimerAccepted.value || phase.value === 'running')
const isEmpty = computed(
  () => entries.value.length === 0 && probeInfo.value === null && activeTaskId.value === ''
)

let unsubscribe: (() => void) | null = null
let currentTaskId = ''

/** 历史状态中文标签（vue-tsc 对模板内 Record 索引推断不稳，收口为函数） */
function statusLabel(status: HistoryEntry['status']): string {
  return STATUS_LABELS[status]
}

/** 体积人性化（历史列表展示） */
function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
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

async function refreshHistory(): Promise<void> {
  try {
    entries.value = (await history()).entries
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
  if (event.kind === 'done' || event.error.code === 'CANCELLED') {
    // PAUSED / CANCELLED / DONE 终态已由主进程写历史，前端刷新即可
    phase.value = 'idle'
    progress.value = null
    activeTaskId.value = ''
    void refreshHistory()
  } else {
    phase.value = 'idle'
    progress.value = null
    activeTaskId.value = ''
    error.value = event.error
    errorDetail.value = event.error.detail ?? ''
    void refreshHistory()
  }
}

async function runProbe(): Promise<void> {
  error.value = null
  errorDetail.value = ''
  probeInfo.value = null
  phase.value = 'probing'
  try {
    probeInfo.value = await probe({ url: url.value.trim() })
    phase.value = 'idle'
  } catch (err) {
    showError(err)
  }
}

async function runDownload(): Promise<void> {
  error.value = null
  errorDetail.value = ''
  phase.value = 'running'
  progress.value = { current: 0 }
  try {
    const { taskId } = await start({
      url: url.value.trim(),
      preset: preset.value,
      ...(outputDir.value.trim() !== '' ? { outputDir: outputDir.value.trim() } : {})
    })
    currentTaskId = taskId
    activeTaskId.value = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    showError(err)
  }
}

/** 暂停 = 登记 PAUSED 意图 + 通用 cancel（abort 后主进程写 PAUSED，.part 保留） */
async function pauseTask(): Promise<void> {
  if (currentTaskId === '') return
  try {
    await markPause({ taskId: currentTaskId })
    await window.lumin.invoke('lumin:task:cancel', { taskId: currentTaskId })
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

/** 续传：同 url/预设/目录重新提交（yt-dlp --continue 接续 .part） */
async function resume(entry: HistoryEntry): Promise<void> {
  url.value = entry.url
  preset.value = entry.preset
  probeInfo.value = null
  await runDownload()
}

async function reveal(entry: HistoryEntry): Promise<void> {
  try {
    await revealPath(entry.outputDir)
  } catch (err) {
    showError(err)
  }
}

async function wipeHistory(): Promise<void> {
  try {
    await clearHistory()
    await refreshHistory()
  } catch (err) {
    showError(err)
  }
}

function retry(): void {
  error.value = null
  errorDetail.value = ''
  void runProbe()
}

/** 免责弹窗：同意并继续（勾选「不再提示」时持久化） */
async function acceptDisclaimer(): Promise<void> {
  if (dontShowAgain.value) {
    try {
      await window.lumin.settings.set(`tools.video-download.${DISCLAIMER_KEY}`, true)
    } catch {
      // 持久化失败不阻塞使用，仅下次仍弹窗
    }
  }
  disclaimerAccepted.value = true
  disclaimerVisible.value = false
}

/** 关闭弹窗未同意 → 主功能区保持置灰 */
function declineDisclaimer(): void {
  disclaimerVisible.value = false
}

/** 重新查看声明（可在此改「不再提示」） */
function openDisclaimer(): void {
  dontShowAgain.value = disclaimerAccepted.value
  disclaimerVisible.value = true
}

onMounted(() => {
  void window.lumin.settings
    .get<boolean>(`tools.video-download.${DISCLAIMER_KEY}`, false)
    .then((accepted) => {
      disclaimerAccepted.value = accepted
      if (!accepted) disclaimerVisible.value = true
    })
  void refreshHistory()
})

onUnmounted(detach)
</script>

<template>
  <div class="flex max-w-2xl flex-col gap-4">
    <!-- 免责 banner（三重呈现 #2，常驻不可关闭） -->
    <div
      class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-warning, #f0a020)] bg-[var(--lumin-color-surface)] px-3 py-2 text-xs text-[var(--lumin-color-text-secondary)]"
    >
      仅供个人学习与研究使用，请遵守平台条款与著作权法
      <button
        class="ml-2 inline-flex items-center gap-1 text-[var(--lumin-color-primary)] hover:underline"
        @click="openDisclaimer"
      >
        <ShieldCheck class="h-3.5 w-3.5" />查看声明
      </button>
    </div>

    <div>
      <h1 class="text-base font-semibold">视频下载</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">粘贴视频链接，下载到本地</p>
    </div>

    <!-- 输入区（未同意免责时置灰） -->
    <NSpace vertical :class="{ 'pointer-events-none opacity-50': mainDisabled }">
      <NInput
        v-model:value="url"
        placeholder="https://…"
        :disabled="phase === 'running'"
        @keydown.enter="runProbe"
      />
      <NSpace>
        <NSelect
          v-model:value="preset"
          :options="[...PRESET_OPTIONS]"
          class="w-40"
          :disabled="phase === 'running'"
        />
        <NInput
          v-model:value="outputDir"
          placeholder="输出目录（留空 = 默认下载目录）"
          class="w-72"
          :disabled="phase === 'running'"
        />
      </NSpace>
      <NSpace>
        <NButton :loading="phase === 'probing'" :disabled="url === '' || phase === 'running'" @click="runProbe">
          获取信息
        </NButton>
        <NButton
          type="primary"
          :disabled="phase !== 'idle' || url === ''"
          @click="runDownload"
        >
          下载
        </NButton>
      </NSpace>
    </NSpace>

    <!-- 信息卡 -->
    <div
      v-if="probeInfo !== null"
      class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] p-3"
    >
      <NText class="text-sm font-medium">{{ probeInfo.title }}</NText>
      <NText depth="3" class="mt-1 block text-xs">
        {{ probeInfo.platform ?? '' }}
        <template v-if="probeInfo.durationSec !== undefined">
          · 时长 {{ Math.round(probeInfo.durationSec) }} 秒
        </template>
      </NText>
    </div>

    <!-- 加载态（任务进行中：进度可见 + 可取消 + 可暂停） -->
    <div v-if="phase === 'running' && progress !== null" class="flex flex-col gap-2">
      <TaskProgress
        :message="progress.message ?? '下载中…'"
        :current="progress.current"
        :total="progress.total"
        cancel-text="取消"
        @cancel="cancelTask"
      />
      <NButton size="small" class="w-fit" @click="pauseTask">暂停</NButton>
    </div>

    <!-- 空态：引导 + 无白屏 -->
    <NEmpty v-if="isEmpty && phase === 'idle' && error === null" description="粘贴视频链接开始下载" />

    <!-- 历史列表 -->
    <div v-if="entries.length > 0" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <NText depth="2" class="text-sm font-medium">下载历史</NText>
        <NPopconfirm positive-text="确认" @positive-click="wipeHistory">
          <template #trigger>
            <NButton size="tiny" quaternary type="error">清空历史</NButton>
          </template>
          确认清空全部历史记录？
        </NPopconfirm>
      </div>
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="flex items-center justify-between rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm">
            {{ entry.title !== '' ? entry.title : entry.url }}
          </div>
          <div class="mt-0.5 flex items-center gap-2 text-xs text-[var(--lumin-color-text-secondary)]">
            <NTag size="tiny" :bordered="false">{{ statusLabel(entry.status) }}</NTag>
            <span v-if="entry.outputName !== undefined">{{ entry.outputName }}</span>
            <span v-if="entry.downloadedBytes !== undefined">{{ formatBytes(entry.downloadedBytes) }}</span>
          </div>
        </div>
        <NSpace :size="4">
          <NButton
            v-if="entry.status === 'PAUSED'"
            size="tiny"
            type="primary"
            quaternary
            @click="resume(entry)"
          >
            <RotateCcw class="mr-1 h-3.5 w-3.5" />继续下载
          </NButton>
          <NButton
            v-if="entry.status === 'DONE' || entry.status === 'PAUSED'"
            size="tiny"
            quaternary
            @click="reveal(entry)"
          >
            <FolderOpen class="mr-1 h-3.5 w-3.5" />打开文件夹
          </NButton>
        </NSpace>
      </div>
    </div>

    <!-- 报错态：结构化错误码 → 中文文案 + 重试/详情 -->
    <div v-if="error !== null" class="flex flex-col gap-1">
      <NText type="error" class="text-sm">{{ error.message }}</NText>
      <details v-if="errorDetail !== ''">
        <summary class="cursor-pointer text-xs text-[var(--lumin-color-text-secondary)]">详情</summary>
        <NText depth="3" class="block break-all text-xs">{{ errorDetail }}</NText>
      </details>
      <NButton size="small" class="w-fit" @click="retry">重试</NButton>
    </div>

    <!-- 免责弹窗（三重呈现 #1：首次进入展示；[同意并继续] 唯一主按钮） -->
    <NModal
      v-model:show="disclaimerVisible"
      preset="card"
      title="使用前须知"
      class="max-w-lg"
      :mask-closable="false"
      @after-leave="declineDisclaimer"
    >
      <p class="text-sm leading-relaxed text-[var(--lumin-color-text-secondary)]">
        {{ DISCLAIMER_TEXT }}
      </p>
      <div class="mt-4 flex items-center justify-between">
        <NCheckbox v-model:checked="dontShowAgain">不再提示</NCheckbox>
        <NButton type="primary" @click="acceptDisclaimer">同意并继续</NButton>
      </div>
    </NModal>
  </div>
</template>
