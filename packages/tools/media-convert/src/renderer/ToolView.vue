<script setup lang="ts">
// 音视频处理主视图（M14：格式转换/截取/提取音频/压缩四 Tab；M50 音频互转；M57 格式转换增强）
// 作者：cuilanchao · 修改时间：2026-11-23
// 三态强制（空态拖拽引导/加载进度可取消/报错码 + 详情）、tokens、@lucide/vue（spec §3）
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  NButton,
  NCheckbox,
  NEmpty,
  NInput,
  NInputNumber,
  NRadioButton,
  NRadioGroup,
  NSpace,
  NSwitch,
  NTabPane,
  NTabs,
  NText
} from 'naive-ui'
import { Film, FolderOpen, RotateCcw, X } from '@lucide/vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { config, process, probe, revealPath, saveOutputDir } from './client'
import { errorMessage, isRetryable } from '../errors'
import { formatClock, parseTimecode } from '../media'
import { canRemux, codecSelectable, type AudioFormat, type VideoContainer } from '../compat'
import type { VideoStream, AudioStream } from '../schema'
import type { OutputItem, ProcessFailure, ProcessPayload } from '../schema'

/** Tab 标识（spec §2） */
type TabId = 'transcode' | 'trim' | 'extract-audio' | 'audio-convert' | 'compress'

/** 质量档中文标签（格式转换 / 压缩共用，spec §2） */
const QUALITY_OPTIONS = [
  { label: '高（体积大）', value: 'high' },
  { label: '中（推荐）', value: 'medium' },
  { label: '低（体积小）', value: 'low' }
] as const

/** 视频目标容器（spec §2.1） */
const CONTAINER_OPTIONS: Array<{ label: string; value: VideoContainer }> = [
  { label: 'MP4', value: 'mp4' },
  { label: 'MKV', value: 'mkv' },
  { label: 'WebM', value: 'webm' },
  { label: 'MOV', value: 'mov' },
  { label: 'AVI', value: 'avi' },
  { label: 'FLV', value: 'flv' },
  { label: 'TS', value: 'ts' },
  { label: 'M4V', value: 'm4v' }
]

/** 提取音频目标格式（5 种） */
const EXTRACT_FORMATS = [
  { label: 'MP3', value: 'mp3' },
  { label: 'M4A（AAC）', value: 'm4a' },
  { label: 'WAV（无损）', value: 'wav' },
  { label: 'FLAC（无损）', value: 'flac' },
  { label: 'OGG（Vorbis）', value: 'ogg' }
] as const

/** 音频互转目标格式（7 种） */
const CONVERT_FORMATS: Array<{ label: string; value: AudioFormat }> = [
  { label: 'MP3', value: 'mp3' },
  { label: 'M4A（AAC）', value: 'm4a' },
  { label: 'WAV（无损）', value: 'wav' },
  { label: 'FLAC（无损）', value: 'flac' },
  { label: 'OGG（Vorbis）', value: 'ogg' },
  { label: 'AAC', value: 'aac' },
  { label: 'Opus', value: 'opus' }
]

/** 视频输入 accept（spec §1.1；截取/格式转换/压缩仅视频） */
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
const transcodeFormat = ref<VideoContainer>('mp4')
const transcodeMode = ref<'encode' | 'remux'>('encode')
const transcodeCodec = ref<'h264' | 'h265'>('h264')
const transcodeQuality = ref<'high' | 'medium' | 'low'>('medium')
type ResolutionKind = 'original' | 'maxHeight' | 'custom'
const resolutionKind = ref<ResolutionKind>('original')
const resolutionHeight = ref<480 | 720 | 1080>(720)
const customWidth = ref<number | null>(null)
const customHeight = ref<number | null>(null)
const transcodeFps = ref<0 | 24 | 25 | 30 | 60>(0)
const videoBitrate = ref<number | null>(0)
const transcodeAudioBitrate = ref<64 | 96 | 128 | 160 | 192 | 256 | 320>(192)
const removeAudio = ref(false)
const trimStart = ref('')
const trimEnd = ref('')
const trimFastCopy = ref(false)
const extractFormat = ref<'mp3' | 'm4a' | 'wav' | 'flac' | 'ogg'>('mp3')
const extractBitrate = ref(192)
const audioFormat = ref<AudioFormat>('mp3')
const audioBitrate = ref(192)
const audioSampleRate = ref<0 | 44100 | 48000>(0)
const audioChannels = ref<0 | 1 | 2>(0)
const compressLevel = ref<'high' | 'medium' | 'low'>('medium')
const compressMaxHeight = ref(0)

/** 无损音频格式：码率控件置灰（spec §2.3） */
const extractIsLossless = computed(
  () => extractFormat.value === 'wav' || extractFormat.value === 'flac'
)
const audioIsLossless = computed(() => audioFormat.value === 'wav' || audioFormat.value === 'flac')

/** 是否仅换封装（remux）：相关编码控件联动禁用 */
const isRemux = computed(() => transcodeMode.value === 'remux')
/** 容器是否暴露编码器选择（H.264 / H.265） */
const showCodec = computed(() => codecSelectable(transcodeFormat.value))
/** 分辨率下拉的合成值（原始 / 480 / 720 / 1080 / custom） */
const resolutionValue = computed<string>({
  get: () => {
    if (resolutionKind.value === 'original') return 'original'
    if (resolutionKind.value === 'custom') return 'custom'
    return String(resolutionHeight.value)
  },
  set: (value) => {
    if (value === 'original') resolutionKind.value = 'original'
    else if (value === 'custom') resolutionKind.value = 'custom'
    else {
      resolutionKind.value = 'maxHeight'
      resolutionHeight.value = Number(value) as 480 | 720 | 1080
    }
  }
})

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

/** remux 下与目标容器不兼容的文件（行内提示并禁用开始，spec §2.1） */
const remuxIncompatible = computed(() =>
  !isRemux.value
    ? []
    : rows.value.filter(
        (row) =>
          !canRemux(transcodeFormat.value, row.video?.codec ?? null, row.audio?.codec ?? null)
      )
)

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
    const resolution =
      resolutionKind.value === 'custom'
        ? {
            kind: 'custom' as const,
            width: customWidth.value ?? 0,
            height: customHeight.value ?? 0
          }
        : resolutionKind.value === 'maxHeight'
          ? { kind: 'maxHeight' as const, height: resolutionHeight.value }
          : { kind: 'original' as const }
    if (
      resolution.kind === 'custom' &&
      (resolution.width < 16 ||
        resolution.width > 7680 ||
        resolution.height < 16 ||
        resolution.height > 7680 ||
        resolution.width % 2 !== 0 ||
        resolution.height % 2 !== 0)
    ) {
      showError({ code: 'MC_PARAM_INVALID', message: '自定义分辨率需为 16–7680 的偶数' })
      return null
    }
    return {
      mode: 'transcode',
      files,
      outputDir: dir,
      options: {
        format: transcodeFormat.value,
        mode: transcodeMode.value,
        quality: transcodeQuality.value,
        codec: transcodeCodec.value,
        resolution,
        fps: transcodeFps.value,
        videoBitrateKbps: videoBitrate.value ?? 0,
        audioBitrateKbps: transcodeAudioBitrate.value,
        removeAudio: removeAudio.value
      }
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
      options: { format: extractFormat.value, bitrate: extractBitrate.value as 128 | 192 | 320 }
    }
  }
  if (tab.value === 'audio-convert') {
    return {
      mode: 'audio-convert',
      files,
      outputDir: dir,
      options: {
        format: audioFormat.value,
        bitrate: audioBitrate.value as 128 | 192 | 320,
        sampleRate: audioSampleRate.value,
        channels: audioChannels.value
      }
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
        视频/音频格式转换、截取片段、提取音频与压缩（基于 ffmpeg）
      </p>
    </div>

    <!-- 五 Tab：切换不丢文件列表与输出目录 -->
    <!-- 标签必须走 #tab 插槽：当前 naive-ui 构建下自闭合 pane 的 tab 文本不会渲染 -->
    <NTabs v-model:value="tab" type="line">
      <NTabPane name="transcode">
        <template #tab>格式转换</template>
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
            <option v-for="opt in CONTAINER_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
          <NText v-if="transcodeFormat === 'webm'" depth="3" class="text-xs">
            固定 VP9 + Opus
          </NText>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">转换方式</NText>
          <NRadioGroup v-model:value="transcodeMode" :disabled="phase === 'running'" size="small">
            <NRadioButton value="encode">重新编码</NRadioButton>
            <NRadioButton value="remux">仅换封装（快速）</NRadioButton>
          </NRadioGroup>
        </div>
        <div v-if="showCodec" class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">编码器</NText>
          <select
            v-model="transcodeCodec"
            :disabled="phase === 'running' || isRemux"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option value="h264">H.264（兼容性好）</option>
            <option value="h265">H.265（体积更小，兼容性较差且较慢）</option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">质量</NText>
          <select
            v-model="transcodeQuality"
            :disabled="phase === 'running' || isRemux"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option v-for="opt in QUALITY_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">分辨率</NText>
          <select
            v-model="resolutionValue"
            :disabled="phase === 'running' || isRemux"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option value="original">原始</option>
            <option value="1080">1080p</option>
            <option value="720">720p</option>
            <option value="480">480p</option>
            <option value="custom">自定义</option>
          </select>
          <template v-if="resolutionKind === 'custom'">
            <NInputNumber
              v-model:value="customWidth"
              :min="16"
              :max="7680"
              :step="2"
              :disabled="phase === 'running' || isRemux"
              placeholder="宽"
              class="w-28"
            />
            <NText depth="3" class="text-xs">×</NText>
            <NInputNumber
              v-model:value="customHeight"
              :min="16"
              :max="7680"
              :step="2"
              :disabled="phase === 'running' || isRemux"
              placeholder="高"
              class="w-28"
            />
            <NText depth="3" class="text-xs">偶数</NText>
          </template>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">帧率</NText>
          <select
            v-model.number="transcodeFps"
            :disabled="phase === 'running' || isRemux"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option :value="0">原始</option>
            <option :value="24">24 fps</option>
            <option :value="25">25 fps</option>
            <option :value="30">30 fps</option>
            <option :value="60">60 fps</option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">视频码率</NText>
          <NInputNumber
            v-model:value="videoBitrate"
            :min="0"
            :max="50000"
            :step="100"
            :disabled="phase === 'running' || isRemux"
            class="w-32"
          />
          <NText depth="3" class="text-xs">kbps，0 = 按质量档</NText>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">音频码率</NText>
          <select
            v-model.number="transcodeAudioBitrate"
            :disabled="phase === 'running' || isRemux || removeAudio"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option :value="64">64 kbps</option>
            <option :value="96">96 kbps</option>
            <option :value="128">128 kbps</option>
            <option :value="160">160 kbps</option>
            <option :value="192">192 kbps</option>
            <option :value="256">256 kbps</option>
            <option :value="320">320 kbps</option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">去音轨</NText>
          <NSwitch v-model:value="removeAudio" :disabled="phase === 'running' || isRemux" />
          <NText depth="3" class="text-xs">输出无音频（remux 不适用）</NText>
        </div>
        <NText v-if="isRemux && remuxIncompatible.length > 0" type="warning" class="text-xs">
          {{ remuxIncompatible.length }} 个文件编码与
          {{ transcodeFormat.toUpperCase() }} 不兼容，请改用重新编码
        </NText>
        <NText v-if="isRemux" depth="3" class="text-xs">
          仅换封装不重新编码，速度最快，仅改变容器格式
        </NText>
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

      <template v-else-if="tab === 'extract-audio'">
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">目标格式</NText>
          <select
            v-model="extractFormat"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option v-for="opt in EXTRACT_FORMATS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">码率</NText>
          <select
            v-model.number="extractBitrate"
            :disabled="phase === 'running' || extractIsLossless"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option :value="128">128 kbps</option>
            <option :value="192">192 kbps</option>
            <option :value="320">320 kbps</option>
          </select>
          <NText v-if="extractIsLossless" depth="3" class="text-xs">无损格式忽略码率</NText>
        </div>
      </template>

      <template v-else-if="tab === 'audio-convert'">
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">目标格式</NText>
          <select
            v-model="audioFormat"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option v-for="opt in CONVERT_FORMATS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
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
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">采样率</NText>
          <select
            v-model.number="audioSampleRate"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option :value="0">原始</option>
            <option :value="44100">44100 Hz</option>
            <option :value="48000">48000 Hz</option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">声道</NText>
          <select
            v-model.number="audioChannels"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option :value="0">原始</option>
            <option :value="1">单声道</option>
            <option :value="2">立体声</option>
          </select>
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
        :disabled="
          phase !== 'idle' || rows.length === 0 || (isRemux && remuxIncompatible.length > 0)
        "
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
