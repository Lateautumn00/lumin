<script setup lang="ts">
// 图片工具箱主视图（M6 一期：压缩/转换/缩放三 Tab）
// 作者：cuilanchao · 修改时间：2026-11-18
// 三态强制（空态拖拽引导/加载进度可取消/报错码 + 详情）、tokens、@lucide/vue（spec §3）
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  NButton,
  NCheckbox,
  NEmpty,
  NInput,
  NInputNumber,
  NSlider,
  NSpace,
  NTabPane,
  NTabs,
  NTag,
  NText
} from 'naive-ui'
import { FolderOpen, Images, X } from '@lucide/vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { config, process, probe, revealPath, saveOutputDir } from './client'
import { extensionOf } from '../schema'
import type { OutputItem, ProbeItem, TargetFormat } from '../schema'

/** Tab 标识（spec §2） */
type TabId = 'compress' | 'convert' | 'resize'

/** 支持的输出目标格式选项（转换/缩放共用；avif 标注慢，bmp/tiff 无损） */
const FORMAT_OPTIONS = [
  { label: 'JPG（JPEG）', value: 'jpg' },
  { label: 'PNG', value: 'png' },
  { label: 'WebP', value: 'webp' },
  { label: 'AVIF（较慢，5–30s/张）', value: 'avif' },
  { label: 'BMP（无损，体积大）', value: 'bmp' },
  { label: 'TIFF（无损，体积大）', value: 'tiff' }
] as const

/** 压缩 Tab 的目标格式（保持原格式 + 常用输出格式） */
const COMPRESS_TARGET_OPTIONS = [
  { label: '保持原格式', value: 'original' },
  { label: 'JPG（JPEG）', value: 'jpg' },
  { label: 'PNG', value: 'png' },
  { label: 'WebP', value: 'webp' },
  { label: 'AVIF（较慢，5–30s/张）', value: 'avif' }
] as const

/** 无质量参数的目标格式（无损编码，质量滑杆置灰） */
const LOSSLESS_FORMATS = new Set<string>(['png', 'bmp', 'tiff'])

/** DropZone accept 串（与 schema 白名单一致） */
const ACCEPT = '.jpg,.jpeg,.png,.webp,.avif,.gif,.bmp,.tiff'

// —— Tab 与参数（spec §2 默认值） ——
const tab = ref<TabId>('compress')
const compressQuality = ref(75)
const compressTarget = ref<'original' | 'jpg' | 'png' | 'webp' | 'avif'>('original')
const convertFormat = ref<TargetFormat>('jpg')
const convertQuality = ref(75)
const resizeMode = ref<'percent' | 'width' | 'height' | 'fit'>('percent')
const resizePercent = ref(50)
const resizeWidth = ref(1280)
const resizeHeight = ref(720)
const resizeFitWidth = ref(1920)
const resizeFitHeight = ref(1080)
const noUpscale = ref(true)
const resizeFormat = ref<TargetFormat>('jpg')
const resizeQuality = ref(75)

// —— 文件列表与探测 ——
interface FileRow extends ProbeItem {
  /** 文件主名（列表展示） */
  name: string
}

const rows = ref<FileRow[]>([])
const probing = ref(false)
const outputDir = ref('')
/** 拖拽非法文件行内提示（自动清除） */
const invalidHint = ref('')

// —— 任务与结果 ——
const phase = ref<'idle' | 'running'>('idle')
const progress = ref<{ current: number; total?: number; message?: string } | null>(null)
const results = ref<OutputItem[]>([])
const resultFailures = ref<{ input: string; message: string }[]>([])
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')

let unsubscribe: (() => void) | null = null
let currentTaskId = ''

/** 无损格式忽略质量：对应 Tab 的质量滑杆置灰（spec §2.2） */
const compressIsLossless = computed(() => LOSSLESS_FORMATS.has(compressTarget.value))
const convertIsLossless = computed(() => LOSSLESS_FORMATS.has(convertFormat.value))
const resizeIsLossless = computed(() => LOSSLESS_FORMATS.has(resizeFormat.value))

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

/** 体积人性化展示 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/** 压缩率文案（变小为正收益） */
function ratioText(item: OutputItem): string {
  if (item.beforeBytes === 0) return ''
  const ratio = Math.round((1 - item.afterBytes / item.beforeBytes) * 100)
  return ratio >= 0 ? `-${ratio}%` : `+${-ratio}%`
}

/** DropZone select：去重后追加并增量探测 */
async function onAdd(paths: string[]): Promise<void> {
  const known = new Set(rows.value.map((r) => r.file))
  const fresh = paths.filter((p) => !known.has(p))
  if (fresh.length === 0) return
  for (const path of fresh) {
    const ext = extensionOf(path)
    rows.value.push({
      file: path,
      name: path.replace(/^.*[\\/]/, ''),
      format: ext ?? '?',
      width: 0,
      height: 0,
      sizeBytes: 0,
      animated: false
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
      failures?: { input: string; message: string }[]
    }
    results.value = result.outputs ?? []
    resultFailures.value = result.failures ?? []
    return
  }
  if (event.error.code === 'CANCELLED' || event.error.code === 'IT_CANCELLED') return
  error.value = event.error
  errorDetail.value = event.error.detail ?? ''
}

/** 提交批量处理（spec §2 参数 → payload discriminated union） */
async function runProcess(): Promise<void> {
  error.value = null
  errorDetail.value = ''
  results.value = []
  resultFailures.value = []
  if (rows.value.length === 0) {
    error.value = { code: 'IT_NO_FILES', message: '请先添加图片文件' }
    return
  }
  phase.value = 'running'
  progress.value = { current: 0, total: rows.value.length }
  try {
    const payload = buildPayload()
    const { taskId } = await process(payload)
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    showError(err)
  }
}

/** 按当前 Tab 组装 payload（zod discriminated union，spec §4） */
function buildPayload() {
  const files = rows.value.map((row) => row.file)
  const dir = outputDir.value.trim()
  if (tab.value === 'compress') {
    return {
      mode: 'compress' as const,
      files,
      outputDir: dir,
      options: { quality: compressQuality.value, target: compressTarget.value }
    }
  }
  if (tab.value === 'convert') {
    return {
      mode: 'convert' as const,
      files,
      outputDir: dir,
      options: { format: convertFormat.value, quality: convertQuality.value }
    }
  }
  return {
    mode: 'resize' as const,
    files,
    outputDir: dir,
    options: buildResizeOptions()
  }
}

/** 缩放参数（四模式 discriminated union；NInputNumber 可空 → 兜底 1，主进程 zod 兜底校验） */
function buildResizeOptions() {
  const base = {
    noUpscale: noUpscale.value,
    format: resizeFormat.value,
    quality: resizeQuality.value
  }
  if (resizeMode.value === 'percent')
    return { mode: 'percent' as const, percent: resizePercent.value, ...base }
  if (resizeMode.value === 'width')
    return { mode: 'width' as const, width: resizeWidth.value ?? 1, ...base }
  if (resizeMode.value === 'height')
    return { mode: 'height' as const, height: resizeHeight.value ?? 1, ...base }
  return {
    mode: 'fit' as const,
    fitWidth: resizeFitWidth.value ?? 1,
    fitHeight: resizeFitHeight.value ?? 1,
    ...base
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
      <h1 class="text-base font-semibold">图片工具箱</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        批量压缩、格式转换与缩放（基于 ffmpeg）
      </p>
    </div>

    <!-- 三 Tab：压缩/转换/缩放（切换不丢文件列表与输出目录） -->
    <!-- 标签必须走 #tab 插槽：当前 naive-ui 构建下自闭合 pane 的 tab 文本不会渲染 -->
    <NTabs v-model:value="tab" type="line">
      <NTabPane name="compress">
        <template #tab>压缩</template>
      </NTabPane>
      <NTabPane name="convert">
        <template #tab>转换</template>
      </NTabPane>
      <NTabPane name="resize">
        <template #tab>缩放</template>
      </NTabPane>
    </NTabs>

    <!-- 文件列表区（空态 = 拖拽引导；非空时 DropZone 收窄为追加入口） -->
    <NEmpty
      v-if="rows.length === 0 && phase === 'idle' && error === null"
      description="添加图片开始处理"
    />
    <DropZone
      :accept="ACCEPT"
      :hint="
        rows.length === 0
          ? '拖入图片，或点击选择（支持 jpg/png/webp/avif/gif/bmp/tiff）'
          : '继续添加'
      "
      multiple
      :disabled="phase === 'running'"
      @select="onAdd([$event.path])"
      @invalid="onInvalid"
    />
    <NText v-if="invalidHint !== ''" type="warning" class="text-xs">{{ invalidHint }}</NText>
    <div v-if="rows.length > 0" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <NText depth="2" class="text-sm font-medium">
          已选 {{ rows.length }} 张<template v-if="probing"> · 读取信息中…</template>
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
              {{ row.width > 0 ? `${row.width}×${row.height}` : row.format }}
              <template v-if="row.sizeBytes > 0"> · {{ formatBytes(row.sizeBytes) }}</template>
              <NTag v-if="row.animated" size="tiny" :bordered="false" class="ml-1">动画</NTag>
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
      <template v-if="tab === 'compress'">
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">质量</NText>
          <NSlider
            v-model:value="compressQuality"
            :min="1"
            :max="100"
            :disabled="phase === 'running' || compressIsLossless"
            class="flex-1"
          />
          <span class="w-10 text-right text-sm">{{ compressQuality }}</span>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">目标格式</NText>
          <select
            v-model="compressTarget"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option v-for="opt in COMPRESS_TARGET_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
          <NText v-if="compressTarget === 'original'" depth="3" class="text-xs"
            >gif 将转 WebP 保留动画</NText
          >
        </div>
      </template>
      <template v-else-if="tab === 'convert'">
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">目标格式</NText>
          <select
            v-model="convertFormat"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option v-for="opt in FORMAT_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">质量</NText>
          <NSlider
            v-model:value="convertQuality"
            :min="1"
            :max="100"
            :disabled="phase === 'running' || convertIsLossless"
            class="flex-1"
          />
          <span class="w-10 text-right text-sm">{{ convertQuality }}</span>
        </div>
      </template>
      <template v-else>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">缩放模式</NText>
          <select
            v-model="resizeMode"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option value="percent">按百分比</option>
            <option value="width">指定宽</option>
            <option value="height">指定高</option>
            <option value="fit">适配框</option>
          </select>
        </div>
        <div v-if="resizeMode === 'percent'" class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">百分比</NText>
          <NSlider
            v-model:value="resizePercent"
            :min="1"
            :max="500"
            :disabled="phase === 'running'"
            class="flex-1"
          />
          <span class="w-12 text-right text-sm">{{ resizePercent }}%</span>
        </div>
        <div v-else-if="resizeMode === 'width'" class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">目标宽</NText>
          <NInputNumber
            v-model:value="resizeWidth"
            :min="1"
            :max="32768"
            :disabled="phase === 'running'"
            class="w-40"
          />
        </div>
        <div v-else-if="resizeMode === 'height'" class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">目标高</NText>
          <NInputNumber
            v-model:value="resizeHeight"
            :min="1"
            :max="32768"
            :disabled="phase === 'running'"
            class="w-40"
          />
        </div>
        <div v-else class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">适配框</NText>
          <NInputNumber
            v-model:value="resizeFitWidth"
            :min="1"
            :max="32768"
            :disabled="phase === 'running'"
            class="w-40"
          />
          <NInputNumber
            v-model:value="resizeFitHeight"
            :min="1"
            :max="32768"
            :disabled="phase === 'running'"
            class="w-40"
          />
        </div>
        <NCheckbox v-model:checked="noUpscale" :disabled="phase === 'running'"
          >不放大（目标大于原图时保持原尺寸）</NCheckbox
        >
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">目标格式</NText>
          <select
            v-model="resizeFormat"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option v-for="opt in FORMAT_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">质量</NText>
          <NSlider
            v-model:value="resizeQuality"
            :min="1"
            :max="100"
            :disabled="phase === 'running' || resizeIsLossless"
            class="flex-1"
          />
          <span class="w-10 text-right text-sm">{{ resizeQuality }}</span>
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
      <NButton type="primary" :disabled="phase !== 'idle' || rows.length === 0" @click="runProcess">
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
      :current="progress.current"
      :total="progress.total"
      @cancel="cancelTask"
    />

    <!-- 结果区：逐文件成功/失败 -->
    <div v-if="results.length > 0 || resultFailures.length > 0" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <NText depth="2" class="text-sm font-medium">
          完成 {{ results.length }} 张<template v-if="resultFailures.length > 0"
            >，失败 {{ resultFailures.length }} 张</template
          >
        </NText>
        <NButton size="tiny" quaternary @click="revealAll">
          <FolderOpen class="mr-1 h-3.5 w-3.5" />打开所在文件夹
        </NButton>
      </div>
      <div
        v-for="item in results"
        :key="item.output"
        class="flex items-center justify-between rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-1.5"
      >
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm">{{ item.output.replace(/^.*[\\/]/, '') }}</div>
          <div class="text-xs text-[var(--lumin-color-text-secondary)]">
            {{ formatBytes(item.beforeBytes) }} → {{ formatBytes(item.afterBytes) }}
            <span v-if="ratioText(item) !== ''">{{ ratioText(item) }}</span>
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
        <NText depth="3" class="block text-xs">{{ fail.message }}</NText>
      </div>
    </div>

    <!-- 报错态：结构化错误码 → 中文文案 + 详情 -->
    <div v-if="error !== null" class="flex flex-col gap-1">
      <NText type="error" class="text-sm">
        <Images class="mr-1 inline h-3.5 w-3.5" />{{ error.message }}
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
