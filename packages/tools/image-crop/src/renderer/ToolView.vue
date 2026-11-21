<script setup lang="ts">
// 图片裁剪主视图（M35：批量按比例或百分比区域裁剪，ffmpeg 主进程串行 + 可取消）
// 作者：cuilanchao · 修改时间：2026-11-21
// 三态强制（空态拖拽引导/加载进度可取消/报错码 + 详情）、tokens、@lucide/vue（spec §2/§6）
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  NButton,
  NEmpty,
  NInput,
  NInputNumber,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NText
} from 'naive-ui'
import { Crop, FolderOpen, X } from '@lucide/vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { config, process, revealPath, saveOutputDir } from './client'
import { MAX_BATCH_FILES, extensionOf } from '../schema'
import type {
  CropAnchor,
  CropMode,
  CropOptions,
  OutputItem,
  ProcessFailure
} from '../schema'

/** DropZone accept 串（与 schema 白名单一致，spec §3） */
const ACCEPT = '.jpg,.jpeg,.png,.webp,.bmp,.tiff'

/** 比例预设（w:h；custom 走自定义输入，spec §2.3） */
const RATIO_PRESETS = [
  { key: '1:1', label: '1:1', w: 1, h: 1 },
  { key: '4:3', label: '4:3', w: 4, h: 3 },
  { key: '3:4', label: '3:4', w: 3, h: 4 },
  { key: '16:9', label: '16:9', w: 16, h: 9 },
  { key: '9:16', label: '9:16', w: 9, h: 16 },
  { key: 'custom', label: '自定义', w: 1, h: 1 }
] as const

type RatioKey = (typeof RATIO_PRESETS)[number]['key']

/** 九宫格锚点（比例模式：裁剪窗口在图片中的位置，spec §2.3） */
const ANCHOR_OPTIONS: { label: string; value: CropAnchor }[] = [
  { label: '左上', value: 'top-left' },
  { label: '上', value: 'top' },
  { label: '右上', value: 'top-right' },
  { label: '左', value: 'left' },
  { label: '中', value: 'center' },
  { label: '右', value: 'right' },
  { label: '左下', value: 'bottom-left' },
  { label: '下', value: 'bottom' },
  { label: '右下', value: 'bottom-right' }
]

interface FileRow {
  file: string
  name: string
}

const rows = ref<FileRow[]>([])
const mode = ref<CropMode>('ratio')
const ratioKey = ref<RatioKey>('1:1')
const customW = ref<number | null>(1)
const customH = ref<number | null>(1)
const anchor = ref<CropAnchor>('center')
const freeX = ref<number | null>(0)
const freeY = ref<number | null>(0)
const freeW = ref<number | null>(100)
const freeH = ref<number | null>(100)
const outputDir = ref('')
/** 拖拽非法文件行内提示（自动清除） */
const invalidHint = ref('')

const phase = ref<'idle' | 'running'>('idle')
const progress = ref<{ current: number; total?: number; message?: string } | null>(null)
const results = ref<OutputItem[]>([])
const resultFailures = ref<ProcessFailure[]>([])
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')

let unsubscribe: (() => void) | null = null
let currentTaskId = ''

/** 比例参数（自定义时取输入值，空值回退 1） */
const ratioBox = computed(() => {
  const preset = RATIO_PRESETS.find((item) => item.key === ratioKey.value)
  if (preset !== undefined && preset.key !== 'custom') return { w: preset.w, h: preset.h }
  return { w: Math.max(1, customW.value ?? 1), h: Math.max(1, customH.value ?? 1) }
})

/** 自由区域（百分比；空值回退默认） */
const freeBox = computed(() => ({
  x: freeX.value ?? 0,
  y: freeY.value ?? 0,
  width: Math.max(1, freeW.value ?? 100),
  height: Math.max(1, freeH.value ?? 100)
}))

/** 自由区域必须落在图片内（spec §2.3 禁用规则） */
const freeValid = computed(
  () => freeBox.value.x + freeBox.value.width <= 100 && freeBox.value.y + freeBox.value.height <= 100
)

const canStart = computed(
  () =>
    phase.value === 'idle' &&
    rows.value.length > 0 &&
    outputDir.value.trim() !== '' &&
    (mode.value === 'ratio' || freeValid.value)
)

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

/** DropZone select：按绝对路径去重后追加（spec §2.2） */
function onAdd(paths: string[]): void {
  const known = new Set(rows.value.map((row) => row.file))
  for (const path of paths) {
    if (rows.value.length >= MAX_BATCH_FILES) {
      onInvalid(`单批最多 ${MAX_BATCH_FILES} 张图片`)
      break
    }
    if (known.has(path)) continue
    if (extensionOf(path) === null) {
      onInvalid('仅支持 PNG/JPG/WebP/BMP/TIFF 图片')
      continue
    }
    known.add(path)
    rows.value.push({ file: path, name: path.replace(/^.*[\\/]/, '') })
  }
}

/** DropZone invalid：行内提示（3s 自动清除） */
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
  error.value = null
  errorDetail.value = ''
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
  if (event.error.code === 'CANCELLED' || event.error.code === 'IC_CANCELLED') return
  error.value = event.error
  errorDetail.value = event.error.detail ?? ''
}

/** 组装裁剪参数（未使用字段填默认值，schema 允许） */
function buildOptions(): CropOptions {
  if (mode.value === 'ratio') {
    return {
      mode: 'ratio',
      ratioW: ratioBox.value.w,
      ratioH: ratioBox.value.h,
      anchor: anchor.value,
      x: 0,
      y: 0,
      width: 100,
      height: 100
    }
  }
  return {
    mode: 'free',
    ratioW: 1,
    ratioH: 1,
    anchor: 'center',
    x: freeBox.value.x,
    y: freeBox.value.y,
    width: freeBox.value.width,
    height: freeBox.value.height
  }
}

/** 提交批量任务（spec §3 process） */
async function runProcess(): Promise<void> {
  error.value = null
  errorDetail.value = ''
  results.value = []
  resultFailures.value = []
  if (rows.value.length === 0) {
    error.value = { code: 'INVALID_PAYLOAD', message: '请先添加图片文件' }
    return
  }
  if (mode.value === 'free' && !freeValid.value) {
    error.value = { code: 'INVALID_PAYLOAD', message: '裁剪区域超出图片范围' }
    return
  }
  phase.value = 'running'
  progress.value = { current: 0, total: rows.value.length }
  try {
    const { taskId } = await process({
      files: rows.value.map((row) => row.file),
      outputDir: outputDir.value.trim(),
      options: buildOptions()
    })
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
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

function reveal(item: OutputItem): void {
  void revealPath(item.output)
}

/** 打开输出目录（取首个成功结果所在文件夹，spec §2.5） */
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
      <h1 class="text-base font-semibold">图片裁剪</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        批量按比例或区域裁剪图片（基于 ffmpeg，原图不修改）
      </p>
    </div>

    <!-- 文件选择区（空态 = 引导 + 拖拽，spec §2.2） -->
    <NEmpty
      v-if="rows.length === 0 && phase === 'idle' && error === null"
      description="添加图片开始裁剪"
    />
    <DropZone
      :accept="ACCEPT"
      :hint="rows.length === 0 ? '拖入图片，或点击选择（支持 jpg/png/webp/bmp/tiff）' : '继续添加'"
      multiple
      :disabled="phase === 'running'"
      @select="onAdd([$event.path])"
      @invalid="onInvalid"
    />
    <NText v-if="invalidHint !== ''" type="warning" class="text-xs">{{ invalidHint }}</NText>

    <div v-if="rows.length > 0" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <NText depth="2" class="text-sm font-medium">已选 {{ rows.length }} 张</NText>
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

    <!-- 裁剪参数区（比例 / 自由，spec §2.3） -->
    <NSpace vertical :size="12">
      <div class="flex items-center gap-3">
        <NText depth="2" class="w-20 text-sm">裁剪方式</NText>
        <NRadioGroup v-model:value="mode" :disabled="phase === 'running'">
          <NRadioButton value="ratio" label="比例裁剪" />
          <NRadioButton value="free" label="自由裁剪" />
        </NRadioGroup>
      </div>

      <template v-if="mode === 'ratio'">
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">比例</NText>
          <NRadioGroup v-model:value="ratioKey" :disabled="phase === 'running'">
            <NRadioButton
              v-for="opt in RATIO_PRESETS"
              :key="opt.key"
              :value="opt.key"
              :label="opt.label"
            />
          </NRadioGroup>
        </div>
        <div v-if="ratioKey === 'custom'" class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">自定义比</NText>
          <NInputNumber
            v-model:value="customW"
            :min="1"
            :max="100"
            :precision="0"
            :disabled="phase === 'running'"
            class="w-24"
          />
          <NText depth="3" class="text-sm">:</NText>
          <NInputNumber
            v-model:value="customH"
            :min="1"
            :max="100"
            :precision="0"
            :disabled="phase === 'running'"
            class="w-24"
          />
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">裁剪位置</NText>
          <NSelect
            v-model:value="anchor"
            :options="ANCHOR_OPTIONS"
            :disabled="phase === 'running'"
            class="w-32"
          />
        </div>
        <NText depth="3" class="text-xs">按所选比例取原图内最大矩形，位置由九宫格决定</NText>
      </template>

      <template v-else>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">裁剪区域</NText>
          <NInputNumber
            v-model:value="freeX"
            :min="0"
            :max="99"
            :precision="0"
            :disabled="phase === 'running'"
            class="w-24"
          >
            <template #prefix>左</template>
            <template #suffix>%</template>
          </NInputNumber>
          <NInputNumber
            v-model:value="freeY"
            :min="0"
            :max="99"
            :precision="0"
            :disabled="phase === 'running'"
            class="w-24"
          >
            <template #prefix>上</template>
            <template #suffix>%</template>
          </NInputNumber>
          <NInputNumber
            v-model:value="freeW"
            :min="1"
            :max="100"
            :precision="0"
            :disabled="phase === 'running'"
            class="w-24"
          >
            <template #prefix>宽</template>
            <template #suffix>%</template>
          </NInputNumber>
          <NInputNumber
            v-model:value="freeH"
            :min="1"
            :max="100"
            :precision="0"
            :disabled="phase === 'running'"
            class="w-24"
          >
            <template #prefix>高</template>
            <template #suffix>%</template>
          </NInputNumber>
        </div>
        <NText v-if="!freeValid" type="warning" class="text-xs">裁剪区域超出图片范围</NText>
        <NText v-else depth="3" class="text-xs">按图片尺寸的百分比取区域（左+宽、上+高 ≤ 100）</NText>
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
      <NButton type="primary" :disabled="!canStart" @click="runProcess">开始裁剪</NButton>
    </NSpace>

    <!-- 加载态：进度可见 + 可取消（R4 强制） -->
    <TaskProgress
      v-if="phase === 'running' && progress !== null"
      :message="
        progress.message !== '' && progress.message !== undefined
          ? `裁剪中 · ${progress.message}`
          : '裁剪中…'
      "
      :current="progress.current"
      :total="progress.total"
      @cancel="cancelTask"
    />

    <!-- 结果区：逐文件成功/失败（spec §2.5） -->
    <div v-if="results.length > 0 || resultFailures.length > 0" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <NText depth="2" class="text-sm font-medium">
          完成 {{ results.length }} 张<template v-if="resultFailures.length > 0"
            >，失败 {{ resultFailures.length }} 张</template
          >
        </NText>
        <NButton v-if="results.length > 0" size="tiny" quaternary @click="revealAll">
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
        <NText depth="3" class="block text-xs">{{ fail.code }} · {{ fail.message }}</NText>
      </div>
    </div>

    <!-- 报错态：结构化错误码 → 中文文案 + 详情（spec §2.6） -->
    <div v-if="error !== null" class="flex flex-col gap-1">
      <NText type="error" class="text-sm">
        <Crop class="mr-1 inline h-3.5 w-3.5" />{{ error.code }} · {{ error.message }}
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
