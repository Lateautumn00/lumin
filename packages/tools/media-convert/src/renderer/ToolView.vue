<script setup lang="ts">
// 音视频处理主视图（M14：转码/截取/提取音频/压缩四 Tab；M50：新增音频互转）
// 作者：cuilanchao · 修改时间：2026-11-19
// 三态强制（空态拖拽引导/加载进度可取消/报错码 + 详情）、tokens、@lucide/vue（spec §3）
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NCheckbox, NEmpty, NInput, NSpace, NTabPane, NTabs, NText } from 'naive-ui'
import { Film, FolderOpen, RotateCcw, X } from '@lucide/vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { config, process, probe, revealPath, saveOutputDir } from './client'
import { errorMessage, isRetryable } from '../errors'
import { formatClock, parseTimecode } from '../media'
import type { VideoStream, AudioStream } from '../schema'
import type { OutputItem, ProcessFailure, ProcessPayload } from '../schema'

/** Tab 标识（spec §2） */
type TabId = 'transcode' | 'trim' | 'extract-audio' | 'audio-convert' | 'compress'

/** 质量档中文标签（转码 / 压缩共用，spec §2） */
const QUALITY_OPTIONS = [
  { label: '高（体积大）', value: 'high' },
  { label: '中（推荐）', value: 'medium' },
  { label: '低（体积小）', value: 'low' }
] as const

/** 视频输入 accept（spec §1.1；截取/转码/压缩仅视频） */
const VIDEO_ACCEPT = '.mp4,.m4v,.mov,.mkv,.webm,.avi,.flv,.wmv,.ts,.mpg,.mpeg,.3gp'
/** 全部输入 accept（提取音频 Tab 同时接受音频） */
const ALL_ACCEPT = `${VIDEO_ACCEPT},.mp3,.wav,.flac,.aac,.m4a,.ogg,.opus,.wma,.aiff`
/** 音频输入 accept（音频互转 Tab 仅音频） */
const AUDIO_ACCEPT = '.mp3,.wav,.flac,.aac,.m4a,.ogg,.opus,.wma,.aiff'

/** 本轮 Tab 的 DropZone accept */
const accept = computed(() => {
  if (tab.value === 'audio-convert') return AUDIO_ACCEPT
  return tab.value === 'extract-audio' ? ALL_ACCEPT : VIDEO_ACCEPT
})

// —— Tab 与参数（spec §2 默认值） ——
const tab = ref<TabId>('transcode')
const transcodeFormat = ref<'mp4' | 'webm' | 'mkv'>('mp4')
const transcodeQuality = ref<'high' | 'medium' | 'low'>('medium')
const trimStart = ref('')
const trimEnd = ref('')
const trimFastCopy = ref(false)
const audioFormat = ref<'mp3' | 'm4a' | 'wav' | 'flac' | 'ogg'>('mp3')
const audioBitrate = ref(192)
const compressLevel = ref<'high' | 'medium' | 'low'>('medium')
const compressMaxHeight = ref(0)

/** 无损音频格式：码率控件置灰（spec §2.3） */
const audioIsLossless = computed(() => audioFormat.value === 'wav' || audioFormat.value === 'flac')

// —— 文件列表与探测 ——
interface FileRow {
  /** 绝对路径 */
  file: string
  /** 文件名（列表展示） */
  name: string
  durationSec: number
  sizeBytes: number
  video: VideoStream | null
  audio: AudioStream | null
}

const rows = ref<FileRow[]>([])
const probing = ref(false)
const outputDir = ref('')
/** 拖拽/探测非法文件行内提示（自动清除） */
const invalidHint = ref('')

// —— 任务与结果 ——
const phase = ref<'idle' | 'running'>('idle')
const progress = ref<{ current: number; total?: number; message?: string } | null>(null)
const results = ref<OutputItem[]>([])
const resultFailures = ref<ProcessFailure[]>([])
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')

let unsubscribe: (() => void) | null = null
let currentTaskId = ''

/** 体积人性化展示 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/** 行概要：时长 · 分辨率 · 大小（无视频轨显示音频） */
function rowSummary(row: FileRow): string {
  const parts: string[] = []
  if (row.durationSec > 0) parts.push(formatClock(row.durationSec))
  if (row.video !== null) parts.push(`${row.video.width}×${row.video.height}`)
  else if (row.audio !== null) parts.push(`音频 ${row.audio.codec}`)
  if (row.sizeBytes > 0) parts.push(formatBytes(row.sizeBytes))
  return parts.join(' · ')
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

/** DropZone select：去重后追加并增量探测 */
async function onAdd(paths: string[]): Promise<void> {
  const known = new Set(rows.value.map((row) => row.file))
  const fresh = paths.filter((path) => !known.has(path))
  if (fresh.length === 0) return
  for (const path of fresh) {
    rows.value.push({
      file: path,
      name: path.replace(/^.*[\\/]/, ''),
      durationSec: 0,
      sizeBytes: 0,
      video: null,
      audio: null
    })
  }
  probing.value = true
  try {
    const result = await probe({ files: fresh })
    const byFile = new Map(result.items.map((item) => [item.file, item]))
    rows.value = rows.value
      .filter((row) => !fresh.includes(row.file) || byFile.has(row.file))
      .map((row) => {
        const item = byFile.get(row.file)
        return item === undefined ? row : { ...row, ...item, name: row.name }
      })
    const firstFailure = result.failures[0]
    if (firstFailure !== undefined) {
      onInvalid(`${firstFailure.message}：${firstFailure.file.replace(/^.*[\\/]/, '')}`)
    }
  } catch (err) {
    showError(err)
  } finally {
    probing.value = false
  }
}

/** DropZone invalid：行内提示（spec §1 即时过滤非法文件） */
function onInvalid(reason: string): void {
  invalidHint.value = reason
  window.setTimeout(() => {
    invalidHint.value = ''
  }, 3000)
}

function removeRow(path: string): void {
  rows.value = rows.value.filter((row) => row.file !== path)
}

function clearRows(): void {
  rows.value = []
  results.value = []
  resultFailures.value = []
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
    const result = event.result as {
      outputs?: OutputItem[]
      failures?: ProcessFailure[]
    }
    results.value = result.outputs ?? []
    resultFailures.value = result.failures ?? []
    return
  }
  if (event.error.code === 'CANCELLED' || event.error.code === 'MC_CANCELLED') return
  error.value = event.error
  errorDetail.value = event.error.detail ?? ''
}

/** 截取 Tab 时间输入校验（spec §2.2） */
function resolveTrimRange(): { startSec: number; endSec: number } | null {
  const startSec = parseTimecode(trimStart.value)
  const endSec = parseTimecode(trimEnd.value)
  if (startSec === null || endSec === null) {
    showError({ code: 'MC_PARAM_INVALID', message: '时间格式应为 90、1:30 或 01:02:03.5' })
    return null
  }
  if (endSec <= startSec) {
    showError({ code: 'MC_PARAM_INVALID', message: '结束时间必须大于开始时间' })
    return null
  }
  return { startSec, endSec }
}

/** 按当前 Tab 组装 payload（zod discriminated union，spec §4） */
function buildPayload(files: string[]): ProcessPayload | null {
  const dir = outputDir.value.trim()
  if (tab.value === 'transcode') {
    return {
      mode: 'transcode',
      files,
      outputDir: dir,
      options: { format: transcodeFormat.value, quality: transcodeQuality.value }
    }
  }
  if (tab.value === 'trim') {
    const range = resolveTrimRange()
    if (range === null) return null
    return {
      mode: 'trim',
      files,
      outputDir: dir,
      options: { ...range, fastCopy: trimFastCopy.value }
    }
  }
  if (tab.value === 'extract-audio') {
    return {
      mode: 'extract-audio',
      files,
      outputDir: dir,
      options: { format: audioFormat.value, bitrate: audioBitrate.value as 128 | 192 | 320 }
    }
  }
  if (tab.value === 'audio-convert') {
    return {
      mode: 'audio-convert',
      files,
      outputDir: dir,
      options: { format: audioFormat.value, bitrate: audioBitrate.value as 128 | 192 | 320 }
    }
  }
  return {
    mode: 'compress',
    files,
    outputDir: dir,
    options: {
      level: compressLevel.value,
      maxHeight: compressMaxHeight.value as 0 | 480 | 720 | 1080
    }
  }
}

/** 提交批量处理（filesOverride 用于「重试失败项」） */
async function runProcess(filesOverride?: string[]): Promise<void> {
  error.value = null
  errorDetail.value = ''
  results.value = []
  resultFailures.value = []
  const files = filesOverride ?? rows.value.map((row) => row.file)
  if (files.length === 0) {
    showError({ code: 'MC_NO_FILES', message: errorMessage('MC_NO_FILES') })
    return
  }
  const payload = buildPayload(files)
  if (payload === null) return
  phase.value = 'running'
  progress.value = { current: 0, total: 100, message: '准备中…' }
  try {
    const { taskId } = await process(payload)
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    showError(err)
  }
}

/** 重试失败项（仅可重试错误码进入列表按钮） */
function retryFailed(): void {
  const files = resultFailures.value
    .filter((failure) => isRetryable(failure.code))
    .map((failure) => failure.input)
  if (files.length === 0) return
  void runProcess(files)
}

/** 结果失败项是否有可重试项 */
const hasRetryable = computed(() =>
  resultFailures.value.some((failure) => isRetryable(failure.code))
)

async function cancelTask(): Promise<void> {
  if (currentTaskId === '') return
  try {
    await window.lumin.invoke('lumin:task:cancel', { taskId: currentTaskId })
  } catch (err) {
    showError(err)
  }
}

function reveal(item: OutputItem): void {
  void revealPath(item.output)
}

/** 打开输出目录（取首个结果所在文件夹） */
function revealAll(): void {
  const first = results.value[0]
  if (first !== undefined) void revealPath(first.output)
}

/** 系统目录选择（壳通用能力）：选中回填并记忆，取消保持原值 */
async function chooseDir(): Promise<void> {
  try {
    const dir = await window.lumin.pickDirectory('选择输出目录')
    if (dir === null) return
    outputDir.value = dir
    await saveOutputDir(dir)
  } catch (err) {
    showError(err)
  }
}

onMounted(() => {
  void config()
    .then((result) => {
      outputDir.value = result.outputDir
    })
    .catch((err) => showError(err))
})

onUnmounted(detach)
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">音视频处理</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        转码、音频互转、截取片段、提取音频与压缩（基于 ffmpeg）
      </p>
    </div>

    <!-- 五 Tab：切换不丢文件列表与输出目录 -->
    <!-- 标签必须走 #tab 插槽：当前 naive-ui 构建下自闭合 pane 的 tab 文本不会渲染 -->
    <NTabs v-model:value="tab" type="line">
      <NTabPane name="transcode">
        <template #tab>转码</template>
      </NTabPane>
      <NTabPane name="trim">
        <template #tab>截取</template>
      </NTabPane>
      <NTabPane name="extract-audio">
        <template #tab>提取音频</template>
      </NTabPane>
      <NTabPane name="audio-convert">
        <template #tab>音频互转</template>
      </NTabPane>
      <NTabPane name="compress">
        <template #tab>压缩</template>
      </NTabPane>
    </NTabs>

    <!-- 文件列表区（空态 = 拖拽引导；非空时 DropZone 收窄为追加入口） -->
    <NEmpty
      v-if="rows.length === 0 && phase === 'idle' && error === null"
      description="添加音视频开始处理"
    />
    <DropZone
      :accept="accept"
      :hint="rows.length === 0 ? '拖入音视频，或点击选择' : '继续添加'"
      multiple
      :disabled="phase === 'running'"
      @select="onAdd([$event.path])"
      @invalid="onInvalid"
    />
    <NText v-if="invalidHint !== ''" type="warning" class="text-xs">{{ invalidHint }}</NText>
    <div v-if="rows.length > 0" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <NText depth="2" class="text-sm font-medium">
          已选 {{ rows.length }} 个<template v-if="probing"> · 读取信息中…</template>
        </NText>
        <NButton
          size="tiny"
          quaternary
          type="error"
          :disabled="phase === 'running'"
          @click="clearRows"
        >
          清空
        </NButton>
      </div>
      <div class="flex max-h-56 flex-col gap-1 overflow-y-auto">
        <div
          v-for="row in rows"
          :key="row.file"
          class="flex items-center justify-between rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-1.5"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm">{{ row.name }}</div>
            <div class="text-xs text-[var(--lumin-color-text-secondary)]">
              {{ rowSummary(row) }}
            </div>
          </div>
          <NButton
            size="tiny"
            quaternary
            :disabled="phase === 'running'"
            @click="removeRow(row.file)"
          >
            <X class="h-3.5 w-3.5" />
          </NButton>
        </div>
      </div>
    </div>

    <!-- 参数区（随 Tab） -->
    <NSpace vertical :size="12">
      <template v-if="tab === 'transcode'">
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">目标格式</NText>
          <select
            v-model="transcodeFormat"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option value="mp4">MP4（H.264 + AAC）</option>
            <option value="webm">WebM（VP9 + Opus）</option>
            <option value="mkv">MKV（H.264 + AAC）</option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">质量</NText>
          <select
            v-model="transcodeQuality"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option v-for="opt in QUALITY_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
      </template>

      <template v-else-if="tab === 'trim'">
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">开始时间</NText>
          <NInput
            v-model:value="trimStart"
            :disabled="phase === 'running'"
            placeholder="如 0、1:30、01:02:03.5"
            class="w-48"
          />
          <NText depth="2" class="w-20 text-sm">结束时间</NText>
          <NInput
            v-model:value="trimEnd"
            :disabled="phase === 'running'"
            placeholder="如 90、2:00"
            class="w-48"
          />
        </div>
        <NCheckbox v-model:checked="trimFastCopy" :disabled="phase === 'running'">
          快速模式（流复制，起点可能偏移到关键帧）
        </NCheckbox>
      </template>

      <template v-else-if="tab === 'extract-audio' || tab === 'audio-convert'">
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">目标格式</NText>
          <select
            v-model="audioFormat"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option value="mp3">MP3</option>
            <option value="m4a">M4A（AAC）</option>
            <option value="wav">WAV（无损）</option>
            <option value="flac">FLAC（无损）</option>
            <option value="ogg">OGG（Vorbis）</option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">码率</NText>
          <select
            v-model.number="audioBitrate"
            :disabled="phase === 'running' || audioIsLossless"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option :value="128">128 kbps</option>
            <option :value="192">192 kbps</option>
            <option :value="320">320 kbps</option>
          </select>
          <NText v-if="audioIsLossless" depth="3" class="text-xs">无损格式忽略码率</NText>
        </div>
      </template>

      <template v-else>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">质量</NText>
          <select
            v-model="compressLevel"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option v-for="opt in QUALITY_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">分辨率上限</NText>
          <select
            v-model.number="compressMaxHeight"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option :value="0">原尺寸</option>
            <option :value="1080">1080p</option>
            <option :value="720">720p</option>
            <option :value="480">480p</option>
          </select>
          <NText depth="3" class="text-xs">只缩不放</NText>
        </div>
      </template>

      <div class="flex items-center gap-3">
        <NText depth="2" class="w-20 text-sm">输出目录</NText>
        <NInput
          v-model:value="outputDir"
          :disabled="phase === 'running'"
          placeholder="输出目录"
          class="flex-1"
        />
        <NButton :disabled="phase === 'running'" @click="chooseDir">
          <FolderOpen class="mr-1 h-3.5 w-3.5" />选择
        </NButton>
      </div>
    </NSpace>

    <!-- 操作区 -->
    <NSpace>
      <NButton
        type="primary"
        :disabled="phase !== 'idle' || rows.length === 0"
        @click="runProcess()"
      >
        开始处理
      </NButton>
    </NSpace>

    <!-- 加载态：进度可见 + 可取消（R4 强制） -->
    <TaskProgress
      v-if="phase === 'running' && progress !== null"
      :message="
        progress.message !== '' && progress.message !== undefined
          ? `处理中 · ${progress.message}`
          : '处理中…'
      "
      :percent="progress.current"
      @cancel="cancelTask"
    />

    <!-- 结果区：逐文件成功/失败 -->
    <div v-if="results.length > 0 || resultFailures.length > 0" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <NText depth="2" class="text-sm font-medium">
          完成 {{ results.length }} 个<template v-if="resultFailures.length > 0"
            >，失败 {{ resultFailures.length }} 个</template
          >
        </NText>
        <div class="flex items-center gap-1">
          <NButton v-if="hasRetryable" size="tiny" quaternary @click="retryFailed">
            <RotateCcw class="mr-1 h-3.5 w-3.5" />重试失败项
          </NButton>
          <NButton size="tiny" quaternary @click="revealAll">
            <FolderOpen class="mr-1 h-3.5 w-3.5" />打开所在文件夹
          </NButton>
        </div>
      </div>
      <div
        v-for="item in results"
        :key="item.output"
        class="flex items-center justify-between rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-1.5"
      >
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm">{{ item.output.replace(/^.*[\\/]/, '') }}</div>
          <div class="text-xs text-[var(--lumin-color-text-secondary)]">
            {{ formatClock(item.durationSec) }} · {{ formatBytes(item.beforeBytes) }} →
            {{ formatBytes(item.afterBytes) }}
          </div>
        </div>
        <NButton size="tiny" quaternary @click="reveal(item)">
          <FolderOpen class="h-3.5 w-3.5" />
        </NButton>
      </div>
      <div
        v-for="fail in resultFailures"
        :key="fail.input"
        class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-error, #e88080)] px-3 py-1.5"
      >
        <NText type="error" class="block truncate text-sm">{{
          fail.input.replace(/^.*[\\/]/, '')
        }}</NText>
        <NText depth="3" class="block text-xs">{{ errorMessage(fail.code) }}</NText>
      </div>
    </div>

    <!-- 报错态：结构化错误码 → 中文文案 + 详情 -->
    <div v-if="error !== null" class="flex flex-col gap-1">
      <NText type="error" class="text-sm">
        <Film class="mr-1 inline h-3.5 w-3.5" />{{ error.message }}
      </NText>
      <details v-if="errorDetail !== ''">
        <summary class="cursor-pointer text-xs text-[var(--lumin-color-text-secondary)]">
          详情
        </summary>
        <NText depth="3" class="block break-all text-xs">{{ errorDetail }}</NText>
      </details>
    </div>
  </div>
</template>
