<script setup lang="ts">
/**
 * @file ToolView.vue
 * @author cuilanchao
 * @date 2026-11-25
 * @description 文件打印页面：选文件 → print:prepare 逐份准备 → print:show 逐份弹系统对话框；
 *              三态（空/加载可取消/结构化报错）与批处理结果汇总（spec §3）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NInput, NTag } from 'naive-ui'
import { AlertTriangle, Printer, RotateCcw, Trash2, X } from '@lucide/vue'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { formatBytes, toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import {
  PRINT_ACCEPT,
  MAX_PRINT_FILES,
  classifyPrintFile,
  fileNameOf,
  type PrintKind
} from '../formats'
import { isRetryable } from '../errors'
import type { PrepareResult, PrintFailure, ShowResult, StatusResult } from '../schema'
import { cancelTask, fetchStatus, submitCleanup, submitPrepare, submitShow } from './client'

/** 已选文件（路径 + 展示信息） */
interface PickedFile {
  path: string
  name: string
  size: number
  kind: PrintKind
}

/** 页面阶段 */
type Phase = 'idle' | 'preparing' | 'printing' | 'done' | 'error'

/** 进度条数据 */
interface ProgressInfo {
  current: number
  total?: number
  message: string
}

/** 失败汇总项 */
interface SummaryFailure {
  name: string
  code: string
  message: string
  detail?: string
}

/** 批处理结果汇总 */
interface Summary {
  success: number
  cancelled: number
  failures: SummaryFailure[]
}

const KIND_LABELS: Record<PrintKind, string> = {
  office: 'Office',
  pdf: 'PDF',
  image: '图片'
}

const picked = ref<PickedFile[]>([])
const phase = ref<Phase>('idle')
const progress = ref<ProgressInfo | null>(null)
const errInfo = ref<StructuredError | null>(null)
const invalidHint = ref('')
const summary = ref<Summary | null>(null)
const soffice = ref<StatusResult['soffice'] | null>(null)
const sofficePath = ref('')
const savingSoffice = ref(false)
const currentTaskId = ref('')

let unsubscribe: (() => void) | null = null
let cancelRequested = false
let invalidTimer: ReturnType<typeof setTimeout> | null = null

const busy = computed(() => phase.value === 'preparing' || phase.value === 'printing')
const hasOffice = computed(() => picked.value.some((file) => file.kind === 'office'))
const canPrint = computed(
  () => picked.value.length > 0 && picked.value.length <= MAX_PRINT_FILES && !busy.value
)
const progressMessage = computed(() => progress.value?.message ?? '处理中…')
const sofficeLabel = computed(() => {
  if (soffice.value === null) return '检测转换组件…'
  return soffice.value.available ? 'LibreOffice 就绪' : 'LibreOffice 未检测到'
})

/** 从任意抛出物取「是否取消」（任务取消码 CANCELLED 或打印取消） */
function isCancelledError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code
    return code === 'CANCELLED' || code === 'PR_PRINT_CANCELLED'
  }
  return false
}

/** 统一订阅任务事件并解析 done/error（含 invoke 返回前的进度回放） */
function runTask<T>(
  submit: () => Promise<{ taskId: string }>,
  onProgress: (info: ProgressInfo) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let taskId = ''
    const pending: TaskEvent[] = []
    const cleanup = (): void => {
      unsubscribe?.()
      unsubscribe = null
      currentTaskId.value = ''
    }
    const handle = (event: TaskEvent): void => {
      if (taskId === '') {
        pending.push(event)
        return
      }
      if (event.taskId !== taskId) return
      if (event.kind === 'progress') {
        onProgress({
          current: event.current,
          ...(event.total !== undefined ? { total: event.total } : {}),
          message: event.message ?? '处理中…'
        })
        return
      }
      if (event.kind === 'log') return
      cleanup()
      if (event.kind === 'done') resolve(event.result as T)
      else reject(event.error)
    }
    unsubscribe?.()
    unsubscribe = window.lumin.onTaskEvent(handle)
    submit()
      .then((result) => {
        taskId = result.taskId
        currentTaskId.value = taskId
        for (const event of pending.splice(0)) handle(event)
      })
      .catch((err: unknown) => {
        cleanup()
        reject(err instanceof Error ? err : toStructuredError(err))
      })
  })
}

/** 收起报错并回到可重新选择的空态 */
function reset(): void {
  picked.value = []
  summary.value = null
  errInfo.value = null
  progress.value = null
  phase.value = 'idle'
  void submitCleanup().catch(() => undefined)
}

/** 添加单个文件（校验类型/去重/上限） */
function addPicked(path: string, file: File): void {
  if (picked.value.some((item) => item.path.toLowerCase() === path.toLowerCase())) return
  const kind = classifyPrintFile(path)
  if (kind === null) {
    invalidHint.value = `不支持的文件类型：${file.name}`
    return
  }
  if (picked.value.length >= MAX_PRINT_FILES) {
    invalidHint.value = `单次最多打印 ${MAX_PRINT_FILES} 个文件`
    return
  }
  picked.value = [
    ...picked.value,
    { path, name: file.name || fileNameOf(path), size: file.size, kind }
  ]
}

/** 移除单条 */
function removePicked(path: string): void {
  picked.value = picked.value.filter((item) => item.path !== path)
}

function onSelect(payload: { file: File; path: string }): void {
  invalidHint.value = ''
  addPicked(payload.path, payload.file)
}

function onInvalid(reason: string): void {
  invalidHint.value = reason
  if (invalidTimer !== null) clearTimeout(invalidTimer)
  invalidTimer = setTimeout(() => {
    invalidHint.value = ''
    invalidTimer = null
  }, 3000)
}

/** 取消当前任务（prepare/show），并标记批次中止 */
async function cancelCurrent(): Promise<void> {
  cancelRequested = true
  if (currentTaskId.value === '') return
  try {
    await cancelTask(currentTaskId.value)
  } catch {
    // 取消失败由主进程终态兜底
  }
}

/** 保存 soffice 自定义路径并重新检测 */
async function saveSoffice(): Promise<void> {
  savingSoffice.value = true
  try {
    const status = await fetchStatus(sofficePath.value.trim())
    soffice.value = status.soffice
    if (status.soffice.available) invalidHint.value = ''
  } catch (err) {
    errInfo.value = toStructuredError(err)
  } finally {
    savingSoffice.value = false
  }
}

/** 主流程：准备（可取消）→ 逐份弹系统对话框（串行）→ 汇总 */
async function startPrint(): Promise<void> {
  if (!canPrint.value) return
  const inputs = picked.value.map((file) => file.path)
  cancelRequested = false
  errInfo.value = null
  summary.value = null
  progress.value = { current: 0, total: inputs.length, message: '准备打印…' }
  phase.value = 'preparing'

  let prepared: PrepareResult
  try {
    prepared = await runTask<PrepareResult>(
      () => submitPrepare(inputs),
      (info) => {
        progress.value = info
      }
    )
  } catch (err) {
    progress.value = null
    if (isCancelledError(err)) {
      phase.value = 'idle'
      await submitCleanup().catch(() => undefined)
      return
    }
    errInfo.value = toStructuredError(err)
    phase.value = 'error'
    return
  }

  const failures: SummaryFailure[] = prepared.failures.map((item: PrintFailure) => ({
    name: fileNameOf(item.inputPath),
    code: item.code,
    message: item.message,
    ...(item.detail !== undefined ? { detail: item.detail } : {})
  }))
  let success = 0
  let cancelled = 0
  phase.value = 'printing'

  for (const [index, job] of prepared.jobs.entries()) {
    if (cancelRequested) break
    progress.value = {
      current: index,
      total: prepared.jobs.length,
      message: `第 ${index + 1}/${prepared.jobs.length} 份：${job.name}`
    }
    try {
      await runTask<ShowResult>(
        () => submitShow(job.jobId),
        (info) => {
          progress.value = info
        }
      )
      success += 1
    } catch (err) {
      if (isCancelledError(err)) {
        cancelled += 1
        if (cancelRequested) break
      } else {
        const structured = toStructuredError(err)
        failures.push({
          name: job.name,
          code: structured.code,
          message: structured.message,
          ...(structured.detail !== undefined ? { detail: structured.detail } : {})
        })
      }
    }
  }

  summary.value = { success, cancelled, failures }
  progress.value = null
  if (success === 0 && cancelled === 0 && failures[0] !== undefined) {
    errInfo.value = toStructuredError({
      code: failures[0].code,
      message: failures[0].message,
      ...(failures[0].detail !== undefined ? { detail: failures[0].detail } : {})
    })
    phase.value = 'error'
  } else {
    phase.value = 'done'
  }
  await submitCleanup(prepared.jobs.map((job) => job.jobId)).catch(() => undefined)
}

onMounted(() => {
  void fetchStatus()
    .then((status) => {
      soffice.value = status.soffice
      sofficePath.value = status.soffice.customPath
    })
    .catch(() => undefined)
})

onUnmounted(() => {
  if (invalidTimer !== null) clearTimeout(invalidTimer)
  if (currentTaskId.value !== '') void cancelTask(currentTaskId.value).catch(() => undefined)
  unsubscribe?.()
  unsubscribe = null
  void submitCleanup().catch(() => undefined)
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-4">
    <header
      class="flex items-start justify-between gap-4 border-b border-[var(--lumin-color-border)] pb-3"
    >
      <div class="min-w-0">
        <h1 class="text-base font-semibold text-[var(--lumin-color-text)]">文件打印</h1>
        <p class="mt-1 text-xs text-[var(--lumin-color-text-secondary)]">
          支持 Word / Excel / PPT / PDF / 图片，通过系统打印对话框输出
        </p>
      </div>
      <NTag
        size="small"
        :type="soffice === null ? 'default' : soffice.available ? 'success' : 'warning'"
      >
        {{ sofficeLabel }}
      </NTag>
    </header>

    <div
      v-if="soffice !== null && !soffice.available && hasOffice"
      class="flex flex-col gap-2 rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] p-3"
    >
      <p class="text-xs text-[var(--lumin-color-text-secondary)]">
        打印 Office 文件需要 LibreOffice。若已安装但未检测到，可填写 soffice.com / soffice.exe
        完整路径。
      </p>
      <div class="flex items-center gap-2">
        <NInput
          v-model:value="sofficePath"
          size="small"
          placeholder="soffice.com / soffice.exe 完整路径"
          :input-props="{ 'aria-label': 'soffice 路径' }"
        />
        <NButton size="small" :loading="savingSoffice" @click="saveSoffice">保存并检测</NButton>
      </div>
    </div>

    <div
      v-if="picked.length === 0 && !busy"
      class="flex flex-1 flex-col items-center justify-center gap-3"
    >
      <DropZone
        multiple
        :accept="PRINT_ACCEPT"
        hint="拖拽文件到此处，或点击选择（最多 50 个）"
        @select="onSelect"
        @invalid="onInvalid"
      />
      <p v-if="invalidHint !== ''" class="text-xs text-[var(--lumin-color-danger)]">
        {{ invalidHint }}
      </p>
      <p class="text-xs text-[var(--lumin-color-text-secondary)]">
        打印前会逐份预检；PDF 按原始页面尺寸，图片按 A4 等比缩放
      </p>
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col gap-3">
      <TaskProgress
        v-if="busy"
        :message="progressMessage"
        :current="progress?.current"
        :total="progress?.total"
        cancellable
        @cancel="cancelCurrent"
      />

      <div
        v-if="phase === 'error' && errInfo !== null"
        role="alert"
        class="flex flex-col gap-2 rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-danger)] p-3"
      >
        <div class="flex items-start gap-2">
          <AlertTriangle
            :size="18"
            class="mt-0.5 text-[var(--lumin-color-danger)]"
            aria-hidden="true"
          />
          <div class="min-w-0">
            <p class="text-sm font-medium text-[var(--lumin-color-text)]">{{ errInfo.message }}</p>
            <p class="mt-1 text-xs text-[var(--lumin-color-text-secondary)]">
              错误码：{{ errInfo.code }}
            </p>
            <p
              v-if="errInfo.detail !== undefined && errInfo.detail !== ''"
              class="mt-1 break-all text-xs text-[var(--lumin-color-text-secondary)]"
            >
              详情：{{ errInfo.detail }}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <NButton v-if="isRetryable(errInfo.code)" size="small" type="primary" @click="startPrint">
            <template #icon><RotateCcw :size="16" /></template>
            重试
          </NButton>
          <NButton size="small" secondary @click="reset">重新选择</NButton>
        </div>
      </div>

      <div
        v-if="phase === 'done' && summary !== null"
        class="flex flex-col gap-2 rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] p-3"
      >
        <p class="text-sm font-medium text-[var(--lumin-color-text)]">
          已提交打印 {{ summary.success }} 份<template v-if="summary.cancelled > 0">
            ，取消 {{ summary.cancelled }} 份</template
          ><template v-if="summary.failures.length > 0">
            ，失败 {{ summary.failures.length }} 份</template
          >
        </p>
        <ul v-if="summary.failures.length > 0" class="flex flex-col gap-1">
          <li
            v-for="failure in summary.failures"
            :key="`${failure.name}-${failure.code}`"
            class="text-xs text-[var(--lumin-color-text-secondary)]"
          >
            {{ failure.name }} · {{ failure.message }}（{{ failure.code }}）
          </li>
        </ul>
        <div class="flex items-center gap-2">
          <NButton size="small" type="primary" @click="reset">重新选择</NButton>
        </div>
      </div>

      <ul class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
        <li
          v-for="(file, index) in picked"
          :key="file.path"
          class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] px-3 py-2"
        >
          <span class="w-6 shrink-0 text-xs text-[var(--lumin-color-text-secondary)]">
            {{ index + 1 }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm text-[var(--lumin-color-text)]">{{ file.name }}</p>
            <p class="mt-0.5 text-xs text-[var(--lumin-color-text-secondary)]">
              {{ KIND_LABELS[file.kind] }} · {{ formatBytes(file.size) }}
            </p>
          </div>
          <NButton
            quaternary
            circle
            size="tiny"
            :disabled="busy"
            :aria-label="`移除 ${file.name}`"
            @click="removePicked(file.path)"
          >
            <template #icon><X :size="14" /></template>
          </NButton>
        </li>
      </ul>

      <div
        v-if="!busy"
        class="flex items-center gap-2 border-t border-[var(--lumin-color-border)] pt-3"
      >
        <NButton size="small" quaternary :disabled="picked.length === 0" @click="reset">
          <template #icon><Trash2 :size="16" /></template>
          清空
        </NButton>
        <span class="flex-1 text-xs text-[var(--lumin-color-text-secondary)]">
          共 {{ picked.length }} 份，逐份弹出系统打印对话框
        </span>
        <NButton type="primary" :disabled="!canPrint" @click="startPrint">
          <template #icon><Printer :size="16" /></template>
          开始打印
        </NButton>
      </div>
    </div>
  </section>
</template>
