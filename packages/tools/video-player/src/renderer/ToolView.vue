<!--
  @file 视频播放器主视图（空态/加载态/报错态三态强制）
  @author cuilanchao
  @date 2026-11-22
  @description 仅浏览器原生格式（MP4/WebM/OGV/OGG）；主进程把路径解析为 lumin-media:// 协议 URL，
               由壳流式回源（dev 的 http origin 与 UNC 路径下 file:// 会被 Chromium 拦截），
               不复制、不转码；播放/暂停/进度/音量/倍速/全屏一律用原生 <video controls>。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton } from 'naive-ui'
import { AlertTriangle, RotateCcw, Video } from '@lucide/vue'
import { formatBytes, toStructuredError, type StructuredError } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import { isRetryable, playbackError, toolError } from '../errors'
import { UNSUPPORTED_HINT, VIDEO_ACCEPT } from '../formats'
import type { ResolveResult } from '../schema'
import { resolve } from './client'

defineOptions({ name: 'VideoPlayerToolView' })

/** 页面阶段：空 / 解析中 / 就绪 / 报错 */
type Phase = 'empty' | 'loading' | 'ready' | 'error'

const phase = ref<Phase>('empty')
const filePath = ref('')
const video = ref<ResolveResult | null>(null)
const errInfo = ref<StructuredError | null>(null)
const buffering = ref(false)
const videoEl = ref<HTMLVideoElement | null>(null)

const metaText = computed(() =>
  video.value === null ? '' : `${video.value.mime} · ${formatBytes(video.value.size)}`
)

/** 统一错误落点（主进程结构化错误或未知异常） */
function showError(err: unknown): void {
  errInfo.value = toStructuredError(err)
  phase.value = 'error'
}

/**
 * 解析并挂载视频
 * @param path 视频绝对路径
 */
async function openFile(path: string): Promise<void> {
  filePath.value = path
  video.value = null
  errInfo.value = null
  buffering.value = false
  phase.value = 'loading'
  try {
    const result = await resolve({ path })
    video.value = result
    phase.value = 'ready'
  } catch (err) {
    showError(err)
  }
}

/** 重试当前文件；无文件时回到空态 */
async function retry(): Promise<void> {
  if (filePath.value === '') {
    reset()
    return
  }
  await openFile(filePath.value)
}

/** 换一个视频 */
function reset(): void {
  if (videoEl.value !== null) {
    videoEl.value.pause()
    videoEl.value.removeAttribute('src')
    videoEl.value.load()
  }
  video.value = null
  errInfo.value = null
  filePath.value = ''
  buffering.value = false
  phase.value = 'empty'
}

function onSelect(payload: { file: File; path: string }): void {
  void openFile(payload.path)
}

function onInvalid(reason: string): void {
  errInfo.value = toolError('VP_UNSUPPORTED_FORMAT', `${UNSUPPORTED_HINT}（${reason}）`)
  phase.value = 'error'
}

function onVideoError(): void {
  const err = videoEl.value?.error
  // ABORTED（code 1，切换 src 的正常中断）由 playbackError 返回 null 跳过
  const mapped = playbackError(err?.code, err?.message)
  if (mapped === null) return
  errInfo.value = mapped
  phase.value = 'error'
}

function onWaiting(): void {
  buffering.value = true
}

function onPlaying(): void {
  buffering.value = false
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-4">
    <header
      v-if="video !== null"
      class="flex items-start justify-between gap-4 border-b border-[var(--lumin-color-border)] pb-3"
    >
      <div class="min-w-0">
        <h1 class="truncate text-base font-semibold text-[var(--lumin-color-text)]">
          {{ video.name }}
        </h1>
        <p class="mt-1 text-xs text-[var(--lumin-color-text-secondary)]">{{ metaText }}</p>
      </div>
      <NButton size="small" secondary @click="reset">
        <template #icon><Video :size="16" /></template>
        换一个视频
      </NButton>
    </header>

    <div v-if="phase === 'empty'" class="flex flex-1 flex-col items-center justify-center gap-3">
      <DropZone
        :accept="VIDEO_ACCEPT"
        hint="拖拽视频到此处，或点击选择（MP4 / WebM / OGV / OGG）"
        @select="onSelect"
        @invalid="onInvalid"
      />
    </div>

    <div v-else-if="phase === 'loading'" class="flex flex-1 flex-col gap-3" aria-busy="true">
      <div
        class="h-8 w-1/3 animate-pulse rounded-[var(--lumin-radius-md)] bg-[var(--lumin-color-border)]"
      />
      <div
        class="flex-1 animate-pulse rounded-[var(--lumin-radius-lg)] bg-[var(--lumin-color-border)]"
      />
      <p class="text-sm text-[var(--lumin-color-text-secondary)]">正在打开视频…</p>
    </div>

    <div
      v-else-if="phase === 'error' && errInfo !== null"
      class="flex flex-1 flex-col items-center justify-center gap-3 text-center"
    >
      <AlertTriangle :size="32" class="text-[var(--lumin-color-danger)]" aria-hidden="true" />
      <p class="text-sm font-medium text-[var(--lumin-color-text)]">{{ errInfo.message }}</p>
      <p class="text-xs text-[var(--lumin-color-text-secondary)]">错误码：{{ errInfo.code }}</p>
      <p
        v-if="errInfo.detail !== undefined && errInfo.detail !== ''"
        class="max-w-xl break-all text-xs text-[var(--lumin-color-text-secondary)]"
      >
        详情：{{ errInfo.detail }}
      </p>
      <div class="flex items-center gap-2">
        <NButton
          v-if="filePath !== '' && isRetryable(errInfo.code)"
          size="small"
          type="primary"
          @click="retry"
        >
          <template #icon><RotateCcw :size="16" /></template>
          重试
        </NButton>
        <NButton size="small" secondary @click="reset">重新选择</NButton>
      </div>
    </div>

    <div
      v-else
      class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-black"
    >
      <video
        ref="videoEl"
        v-if="video !== null"
        :src="video.url"
        controls
        class="h-full w-full"
        @error="onVideoError"
        @waiting="onWaiting"
        @canplay="onPlaying"
        @playing="onPlaying"
      />
      <p
        v-if="buffering"
        class="absolute bottom-3 left-3 rounded-[var(--lumin-radius-md)] bg-black/60 px-2 py-1 text-xs text-white"
        aria-live="polite"
      >
        缓冲中…
      </p>
    </div>
  </section>
</template>
