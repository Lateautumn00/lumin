<script setup lang="ts">
/**
 * @file ToolView.vue
 * @author cuilanchao
 * @date 2026-11-19
 * @description Office 转 PDF 工具页：批量选择增删、批量转换进度（可取消）、成功/失败汇总与组件引导三态。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NInput, NSpace, NText } from 'naive-ui'
import { Download, FileText, FolderOpen, RefreshCw, RotateCcw, X } from '@lucide/vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { isRetryable } from '../errors'
import { MAX_BATCH_FILES, OFFICE_ACCEPT } from '../formats'
import type { BatchConvertResult, StatusResult } from '../schema'
import {
  cancelTask,
  fetchStatus,
  revealPath,
  setCustomPath,
  submitConvert,
  submitInstall
} from './client'

interface PickedFile {
  path: string
  name: string
}

type Phase = 'idle' | 'converting' | 'installing' | 'error'
type LastAction = 'convert' | 'install'

const phase = ref<Phase>('idle')
const status = ref<StatusResult | null>(null)
const statusFailed = ref(false)
const statusLoading = ref(false)
const files = ref<PickedFile[]>([])
const result = ref<BatchConvertResult | null>(null)
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
const showDropZone = computed(() => files.value.length === 0 && result.value === null)
const showFileList = computed(() => files.value.length > 0 && result.value === null)
const retryable = computed(() => error.value !== null && isRetryable(error.value.code))
const hasDetail = computed(() => (error.value?.detail ?? '') !== '')
const outputCount = computed(() => result.value?.outputs.length ?? 0)
const failureList = computed(() => result.value?.failures ?? [])
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
      const payload = event.result as BatchConvertResult | undefined
      result.value = payload ?? { outputs: [], failures: [] }
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
  if (files.value.length === 0) return
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
  result.value = null
  phase.value = 'converting'
  progress.value = { message: '提交中…' }
  try {
    const { taskId } = await submitConvert(files.value.map((file) => file.path))
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
  files.value = []
  result.value = null
  error.value = null
  progress.value = null
  invalidHint.value = ''
  detailOpen.value = false
  phase.value = 'idle'
}

function onSelect(payload: { file: File; path: string }): void {
  if (files.value.length >= MAX_BATCH_FILES) {
    invalidHint.value = `单次最多 ${MAX_BATCH_FILES} 个文件`
    return
  }
  const key = payload.path.toLowerCase()
  if (files.value.some((file) => file.path.toLowerCase() === key)) return
  files.value.push({ path: payload.path, name: payload.file.name })
  invalidHint.value = ''
  error.value = null
}

function onInvalid(reason: string): void {
  invalidHint.value = reason
}

function removeFile(index: number): void {
  files.value.splice(index, 1)
  invalidHint.value = ''
}

async function openFolder(): Promise<void> {
  const first = result.value?.outputs[0]
  if (first === undefined) return
  try {
    await revealPath(first.outputPath)
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
      <h1 class="text-base font-semibold">Office 转 PDF</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        将 Word / Excel / PPT 文件批量转换为 PDF（LibreOffice 转换组件按需下载）
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

    <!-- 空态：拖拽/多选 -->
    <DropZone
      v-if="showDropZone"
      :accept="OFFICE_ACCEPT"
      hint="拖拽 Office 文件到此处（可多选），或点击选择"
      :disabled="busy"
      multiple
      @select="onSelect"
      @invalid="onInvalid"
    />
    <NText v-if="invalidHint !== ''" type="error" class="text-sm">{{ invalidHint }}</NText>

    <!-- 已选文件列表 -->
    <div
      v-if="showFileList"
      class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] px-4 py-3"
    >
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm font-medium">
          已选 {{ files.length }} 个文件
          <span class="text-xs font-normal text-[var(--lumin-color-text-secondary)]">
            （单次最多 {{ MAX_BATCH_FILES }} 个）
          </span>
        </p>
        <NSpace>
          <NButton size="small" quaternary :disabled="busy" @click="resetForNew">清空</NButton>
        </NSpace>
      </div>
      <ul class="mt-3 max-h-64 space-y-2 overflow-auto" aria-label="待转换文件列表">
        <li
          v-for="(file, index) in files"
          :key="file.path"
          class="flex items-center gap-2 rounded-[var(--lumin-radius-md)] px-2 py-1 hover:bg-[var(--lumin-color-bg)]"
        >
          <FileText
            :size="16"
            class="shrink-0 text-[var(--lumin-color-text-secondary)]"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 truncate text-sm" :title="file.path">{{ file.name }}</span>
          <NButton
            size="tiny"
            quaternary
            :disabled="busy"
            :aria-label="`移除 ${file.name}`"
            @click="removeFile(index)"
          >
            <template #icon><X :size="14" /></template>
          </NButton>
        </li>
      </ul>
      <NSpace class="mt-3">
        <NButton type="primary" :disabled="busy || files.length === 0" @click="startConvert">
          开始转换（{{ files.length }}）
        </NButton>
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

    <!-- 成功结果（含部分失败汇总） -->
    <div
      v-if="result !== null"
      class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] px-4 py-3"
    >
      <NText :type="failureList.length === 0 ? 'success' : 'warning'" class="text-sm font-medium">
        转换完成：成功 {{ outputCount }} 个<template v-if="failureList.length > 0">
          ，失败 {{ failureList.length }} 个</template
        >
      </NText>
      <ul class="mt-2 max-h-40 space-y-1 overflow-auto" aria-label="转换产物">
        <li
          v-for="item in result.outputs"
          :key="item.outputPath"
          class="break-all text-xs text-[var(--lumin-color-text-secondary)]"
          :title="item.outputPath"
        >
          {{ item.outputPath }}
        </li>
      </ul>
      <ul
        v-if="failureList.length > 0"
        class="mt-2 max-h-40 space-y-1 overflow-auto"
        aria-label="转换失败列表"
      >
        <li v-for="item in failureList" :key="item.inputPath" class="text-xs">
          <span class="font-medium">{{ item.inputPath }}</span>
          <span class="ml-1 text-[var(--lumin-color-text-secondary)]">
            {{ item.code }} · {{ item.message }}
          </span>
        </li>
      </ul>
      <NSpace class="mt-3">
        <NButton v-if="outputCount > 0" size="small" type="primary" @click="openFolder">
          <template #icon><FolderOpen :size="14" /></template>
          打开文件夹
        </NButton>
        <NButton size="small" @click="resetForNew">
          <template #icon><RotateCcw :size="14" /></template>
          再转一批
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
