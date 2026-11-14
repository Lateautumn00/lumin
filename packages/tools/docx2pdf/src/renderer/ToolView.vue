<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NInput, NSpace, NText } from 'naive-ui'
import { Download, FileText, FolderOpen, RefreshCw, RotateCcw } from '@lucide/vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { isRetryable } from '../errors'
import type { StatusResult } from '../schema'
import {
  cancelTask,
  fetchStatus,
  revealPath,
  setCustomPath,
  submitConvert,
  submitInstall
} from './client'

type Phase = 'idle' | 'converting' | 'installing' | 'error'
type LastAction = 'convert' | 'install'

const phase = ref<Phase>('idle')
const status = ref<StatusResult | null>(null)
const statusFailed = ref(false)
const statusLoading = ref(false)
const inputPath = ref('')
const inputName = ref('')
const outputPath = ref('')
const progress = ref<{ current?: number; total?: number; message: string } | null>(null)
const error = ref<StructuredError | null>(null)
const detailOpen = ref(false)
const invalidHint = ref('')
const lastAction = ref<LastAction | null>(null)
const customPathInput = ref('')
const pathInput = ref<InstanceType<typeof NInput> | null>(null)

let unsubscribe: (() => void) | null = null
let currentTaskId = ''

const busy = computed(() => phase.value === 'converting' || phase.value === 'installing')
const showDropZone = computed(() => inputPath.value === '' && outputPath.value === '')
const showFileCard = computed(() => inputPath.value !== '' && outputPath.value === '')
const retryable = computed(() => error.value !== null && isRetryable(error.value.code))
const hasDetail = computed(() => (error.value?.detail ?? '') !== '')
const sourceLabel = computed(() => {
  switch (status.value?.source) {
    case 'custom':
      return '自定义路径'
    case 'system':
      return '系统已安装'
    case 'portable':
      return '便携组件'
    case 'none':
      return '未检测到'
    default:
      return statusFailed.value ? '检测失败' : '检测中…'
  }
})

function detach(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  currentTaskId = ''
}

function setError(err: unknown): void {
  error.value = toStructuredError(err)
  detailOpen.value = false
  phase.value = 'error'
  progress.value = null
  detach()
}

async function refreshStatus(): Promise<void> {
  statusLoading.value = true
  try {
    status.value = await fetchStatus()
    statusFailed.value = false
    customPathInput.value = status.value.customPath
  } catch {
    statusFailed.value = true
    status.value = null
  } finally {
    statusLoading.value = false
  }
}

function onEvent(event: TaskEvent): void {
  if (event.taskId !== currentTaskId) return
  if (event.kind === 'progress') {
    progress.value = {
      current: event.current,
      ...(event.total !== undefined ? { total: event.total } : {}),
      message: event.message ?? event.stage ?? ''
    }
    return
  }
  if (event.kind === 'log') return
  detach()
  if (event.kind === 'done') {
    phase.value = 'idle'
    progress.value = null
    if (lastAction.value === 'convert') {
      const result = event.result as { outputPath?: string } | undefined
      outputPath.value = result?.outputPath ?? ''
    } else {
      void refreshStatus()
    }
    return
  }
  if (event.error.code === 'CANCELLED') {
    phase.value = 'idle'
    progress.value = null
    return
  }
  error.value = event.error
  detailOpen.value = false
  phase.value = 'error'
  progress.value = null
}

async function startConvert(): Promise<void> {
  if (inputPath.value === '') return
  if (status.value?.source === 'none') {
    setError({
      code: 'SOFFICE_NOT_FOUND',
      message: '未检测到 LibreOffice 转换组件，请下载安装或指定路径'
    })
    return
  }
  lastAction.value = 'convert'
  error.value = null
  detailOpen.value = false
  phase.value = 'converting'
  progress.value = { message: '提交中…' }
  try {
    const { taskId } = await submitConvert(inputPath.value)
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    setError(err)
  }
}

async function install(): Promise<void> {
  lastAction.value = 'install'
  error.value = null
  detailOpen.value = false
  phase.value = 'installing'
  progress.value = { message: '准备下载…' }
  try {
    const { taskId } = await submitInstall()
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    setError(err)
  }
}

async function onCancel(): Promise<void> {
  if (currentTaskId === '') return
  try {
    await cancelTask(currentTaskId)
  } catch (err) {
    setError(err)
  }
}

function retry(): void {
  if (lastAction.value === 'install') {
    void install()
  } else {
    void startConvert()
  }
}

function resetForNew(): void {
  inputPath.value = ''
  inputName.value = ''
  outputPath.value = ''
  error.value = null
  progress.value = null
  invalidHint.value = ''
  detailOpen.value = false
  phase.value = 'idle'
}

function onSelect(payload: { file: File; path: string }): void {
  inputPath.value = payload.path
  inputName.value = payload.file.name
  invalidHint.value = ''
  error.value = null
}

function onInvalid(reason: string): void {
  invalidHint.value = reason
}

async function openFolder(): Promise<void> {
  if (outputPath.value === '') return
  try {
    await revealPath(outputPath.value)
  } catch (err) {
    setError(err)
  }
}

async function savePath(): Promise<void> {
  try {
    status.value = await setCustomPath(customPathInput.value)
    statusFailed.value = false
    error.value = null
  } catch (err) {
    setError(err)
  }
}

async function clearPath(): Promise<void> {
  customPathInput.value = ''
  await savePath()
}

function focusPathInput(): void {
  pathInput.value?.focus()
}

onMounted(() => {
  void refreshStatus()
})

onUnmounted(() => {
  detach()
})
</script>

<template>
  <div class="flex max-w-2xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">Word 转 PDF</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        将 .doc/.docx 文件转换为 PDF（LibreOffice 转换组件按需下载）
      </p>
    </div>

    <!-- 组件状态横幅（spec §6 空态引导） -->
    <div
      class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] px-4 py-3"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2 text-sm">
            <span class="font-medium">转换组件</span>
            <NText :type="status?.source === 'none' ? 'warning' : 'success'" depth="3">
              {{ sourceLabel }}
            </NText>
          </div>
          <p
            v-if="status?.path"
            class="mt-1 truncate text-xs text-[var(--lumin-color-text-secondary)]"
            :title="status.path"
          >
            {{ status.path }}
          </p>
          <NText v-if="status?.customInvalid" type="warning" class="mt-1 block text-xs">
            自定义路径无效，已回退系统检测
          </NText>
          <NText v-if="statusFailed" type="error" class="mt-1 block text-xs">
            组件状态检测失败，请重新检测
          </NText>
        </div>
        <NButton size="small" quaternary :loading="statusLoading" @click="refreshStatus">
          <template #icon><RefreshCw :size="14" /></template>
          重新检测
        </NButton>
      </div>
      <template v-if="status?.source === 'none'">
        <p class="mt-2 text-xs text-[var(--lumin-color-text-secondary)]">
          未检测到可用的 LibreOffice。可下载便携组件（约 358.8 MB，解包后约 1.86
          GiB），或指定本机已有的 soffice 路径。
        </p>
        <NSpace class="mt-2">
          <NButton
            size="small"
            type="primary"
            :disabled="busy"
            :loading="phase === 'installing'"
            @click="install"
          >
            <template #icon><Download :size="14" /></template>
            下载安装组件
          </NButton>
          <NButton size="small" :disabled="busy" @click="focusPathInput">指定已有路径</NButton>
        </NSpace>
      </template>
    </div>

    <!-- 空态：拖拽/选择 -->
    <DropZone
      v-if="showDropZone"
      accept=".doc,.docx"
      hint="拖拽 Word 文件到此处，或点击选择"
      :disabled="busy"
      @select="onSelect"
      @invalid="onInvalid"
    />
    <NText v-if="invalidHint !== ''" type="error" class="text-sm">{{ invalidHint }}</NText>

    <!-- 已选文件卡 -->
    <div
      v-if="showFileCard"
      class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] px-4 py-3"
    >
      <FileText
        :size="20"
        class="shrink-0 text-[var(--lumin-color-text-secondary)]"
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium" :title="inputName">{{ inputName }}</p>
        <p class="truncate text-xs text-[var(--lumin-color-text-secondary)]" :title="inputPath">
          {{ inputPath }}
        </p>
      </div>
      <NSpace>
        <NButton type="primary" :disabled="busy" @click="startConvert">开始转换</NButton>
        <NButton :disabled="busy" @click="resetForNew">重新选择</NButton>
      </NSpace>
    </div>

    <!-- 加载态：转换 / 下载安装进度（可取消） -->
    <TaskProgress
      v-if="phase === 'converting' || phase === 'installing'"
      :message="progress?.message ?? ''"
      :current="progress?.current"
      :total="progress?.total"
      @cancel="onCancel"
    />

    <!-- 成功结果 -->
    <div
      v-if="outputPath !== ''"
      class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] px-4 py-3"
    >
      <NText type="success" class="text-sm font-medium">转换完成</NText>
      <p
        class="mt-1 break-all text-xs text-[var(--lumin-color-text-secondary)]"
        :title="outputPath"
      >
        {{ outputPath }}
      </p>
      <NSpace class="mt-3">
        <NButton size="small" type="primary" @click="openFolder">
          <template #icon><FolderOpen :size="14" /></template>
          打开文件夹
        </NButton>
        <NButton size="small" @click="resetForNew">
          <template #icon><RotateCcw :size="14" /></template>
          再转一个
        </NButton>
      </NSpace>
    </div>

    <!-- 报错态（spec §5/§6） -->
    <div
      v-if="phase === 'error' && error !== null"
      class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-danger)] px-4 py-3"
    >
      <NText type="error" class="text-sm font-medium">{{ error.message }}</NText>
      <p class="mt-1 text-xs text-[var(--lumin-color-text-secondary)]">错误码：{{ error.code }}</p>
      <div v-if="hasDetail" class="mt-2">
        <NButton size="small" quaternary @click="detailOpen = !detailOpen">
          {{ detailOpen ? '收起详情' : '查看详情' }}
        </NButton>
        <p
          v-if="detailOpen"
          class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-[var(--lumin-color-text-secondary)]"
        >
          {{ error.detail }}
        </p>
      </div>
      <NSpace class="mt-3">
        <NButton v-if="retryable" size="small" type="primary" @click="retry">重试</NButton>
        <NButton
          v-if="error.code === 'SOFFICE_NOT_FOUND'"
          size="small"
          type="primary"
          :disabled="busy"
          @click="install"
        >
          <template #icon><Download :size="14" /></template>
          下载安装组件
        </NButton>
        <NButton v-if="error.code === 'INPUT_NOT_FOUND'" size="small" @click="resetForNew">
          重新选择
        </NButton>
      </NSpace>
    </div>

    <!-- 组件管理区（spec §3.2，留在工具页内） -->
    <div
      class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] px-4 py-3"
    >
      <p class="text-sm font-medium">组件管理</p>
      <p class="mt-1 text-xs text-[var(--lumin-color-text-secondary)]">
        下载便携组件到应用数据目录（不写系统注册表），或指定本机已安装的 soffice
        路径；清空即恢复三级定位。
      </p>
      <NSpace class="mt-3" align="center">
        <NButton
          size="small"
          :disabled="phase === 'converting' || phase === 'installing'"
          :loading="phase === 'installing'"
          @click="install"
        >
          <template #icon><Download :size="14" /></template>
          下载安装组件
        </NButton>
      </NSpace>
      <div class="mt-3 flex items-center gap-2">
        <NInput
          ref="pathInput"
          v-model:value="customPathInput"
          size="small"
          placeholder="soffice.com / soffice.exe 完整路径"
          :disabled="phase === 'converting' || phase === 'installing'"
          @keydown.enter="savePath"
        />
        <NButton size="small" :disabled="busy" :loading="statusLoading" @click="savePath"
          >保存</NButton
        >
        <NButton size="small" quaternary :disabled="busy" @click="clearPath">清空</NButton>
      </div>
    </div>
  </div>
</template>
