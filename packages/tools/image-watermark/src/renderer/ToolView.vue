<script setup lang="ts">
/**
 * 图片批量水印（image-watermark）：多选图片 → 文字/图片水印 → 输出到指定目录。
 * 三态：空态（DropZone）/ 加载态（逐张进度、可取消）/ 报错态（重试或重选）；结果态内联展示。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { FolderOpen, Plus, RefreshCw, Trash2, X } from '@lucide/vue'
import {
  NAlert,
  NButton,
  NColorPicker,
  NInput,
  NInputNumber,
  NRadio,
  NRadioGroup,
  NSlider,
  NSwitch
} from 'naive-ui'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import PathLink from '@lumin/ui/PathLink.vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import {
  anchorPosition,
  clampOpacity,
  imageWatermarkSize,
  normalizeRotation,
  percentToPx,
  shortEdge,
  textFontSize,
  textHeight,
  tilePositions
} from '../contract'
import { isRetryable } from '../errors'
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  POSITIONS,
  type Position,
  type Watermark,
  type WatermarkPayload,
  type WatermarkResult
} from '../schema'
import {
  cancelTask,
  config,
  pickDirectory,
  revealPath,
  setOutputDir,
  submitWatermark
} from './client'

/** 已选图片（url 为预览 ObjectURL，移除/卸载时 revoke） */
interface PickedImage {
  file: File
  path: string
  url: string
  size: number
}

/** 九宫格按钮文案（顺序同 POSITIONS） */
const POSITION_LABELS: Record<Position, string> = {
  'top-left': '左上',
  'top-center': '上',
  'top-right': '右上',
  'middle-left': '左',
  center: '中',
  'middle-right': '右',
  'bottom-left': '左下',
  'bottom-center': '下',
  'bottom-right': '右下'
}

const ACCEPT = '.png,.jpg,.jpeg,.webp'
const PREVIEW_MAX_W = 480
const PREVIEW_MAX_H = 320

const files = ref<PickedImage[]>([])
const watermarkType = ref<'text' | 'image'>('text')
const text = ref('内部资料')
const color = ref('#ffffff')
const sizePct = ref(8)
const imageSizePct = ref(20)
const opacity = ref(30)
const rotation = ref(0)
const position = ref<Position>('bottom-right')
const marginPct = ref(3)
const tile = ref(false)
const watermarkImage = ref<PickedImage | null>(null)
const outputDir = ref('')
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const invalidHint = ref('')
const phase = ref<'idle' | 'running' | 'error'>('idle')
const progress = ref<{ current: number; total: number; message: string } | null>(null)
const error = ref<StructuredError | null>(null)
const result = ref<WatermarkResult | null>(null)
const showAllOutputs = ref(false)

let currentTaskId = ''
let unsubscribe: (() => void) | undefined
let previewTimer: number | undefined
let previewSeq = 0

const canStart = computed(
  () =>
    files.value.length > 0 &&
    currentWatermark() !== null &&
    outputDir.value !== '' &&
    phase.value !== 'running'
)

/** 字号（文字水印）与宽度（图片水印）共用滑杆的读写代理 */
const sizeValue = computed({
  get: () => (watermarkType.value === 'text' ? sizePct.value : imageSizePct.value),
  set: (value: number) => {
    if (watermarkType.value === 'text') sizePct.value = value
    else imageSizePct.value = value
  }
})

const sizeOptions = computed(() => ({
  label: watermarkType.value === 'text' ? '字号' : '宽度',
  min: 2,
  max: 50
}))

/** 当前水印参数（必填未就绪返回 null，按钮置灰） */
function currentWatermark(): Watermark | null {
  const base = {
    sizePct: sizeValue.value,
    opacity: opacity.value,
    rotation: rotation.value,
    position: position.value,
    marginPct: marginPct.value,
    tile: tile.value
  }
  if (watermarkType.value === 'text') {
    if (text.value.trim() === '') return null
    return { type: 'text', text: text.value, color: color.value, ...base }
  }
  if (watermarkImage.value === null) return null
  return { type: 'image', watermarkPath: watermarkImage.value.path, ...base }
}

/** 预览签名：图片 + 参数任一变化即防抖重绘 */
const previewSignature = computed(() =>
  JSON.stringify({
    first: files.value[0]?.url ?? '',
    watermark: currentWatermark()
  })
)

watch(previewSignature, () => schedulePreview(), { immediate: true })

function schedulePreview(): void {
  if (previewTimer !== undefined) window.clearTimeout(previewTimer)
  previewTimer = window.setTimeout(() => {
    previewTimer = undefined
    void drawPreview()
  }, 200)
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
}

/** 画布预览（与 worker 共用 contract 布局纯函数；不写盘） */
async function drawPreview(): Promise<void> {
  const canvas = previewCanvas.value
  const first = files.value[0]
  if (canvas === null || first === undefined) return
  const seq = ++previewSeq
  try {
    const source = await loadHtmlImage(first.url)
    if (seq !== previewSeq) return
    const scale = Math.min(
      PREVIEW_MAX_W / source.naturalWidth,
      PREVIEW_MAX_H / source.naturalHeight,
      1
    )
    const width = Math.max(1, Math.round(source.naturalWidth * scale))
    const height = Math.max(1, Math.round(source.naturalHeight * scale))
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    ctx.drawImage(source, 0, 0, width, height)

    const watermark = currentWatermark()
    if (watermark === null) return
    const edge = shortEdge(width, height)
    const alpha = clampOpacity(watermark.opacity)
    const rad = (normalizeRotation(watermark.rotation) * Math.PI) / 180

    if (watermark.type === 'text') {
      const fontPx = textFontSize(watermark.sizePct, edge)
      const font = `600 ${fontPx}px "Microsoft YaHei", "PingFang SC", sans-serif`
      ctx.font = font
      const markW = Math.max(1, Math.ceil(ctx.measureText(watermark.text.trim()).width))
      const markH = textHeight(fontPx)
      const centers = watermark.tile
        ? tilePositions(width, height, markW, markH, watermark.rotation)
        : [
            anchorPosition(
              width,
              height,
              markW,
              markH,
              watermark.position,
              percentToPx(watermark.marginPct, edge)
            )
          ]
      for (const point of centers) {
        ctx.save()
        ctx.translate(point.x, point.y)
        ctx.rotate(rad)
        ctx.globalAlpha = alpha
        ctx.font = font
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = watermark.color
        ctx.fillText(watermark.text.trim(), 0, 0)
        ctx.restore()
      }
      return
    }

    const mark = watermarkImage.value
    if (mark === null) return
    const markImage = await loadHtmlImage(mark.url)
    if (seq !== previewSeq) return
    const size = imageWatermarkSize(markImage.naturalWidth, markImage.naturalHeight, watermark.sizePct, edge)
    if (size === null) return
    const centers = watermark.tile
      ? tilePositions(width, height, size.width, size.height, watermark.rotation)
      : [
          anchorPosition(
            width,
            height,
            size.width,
            size.height,
            watermark.position,
            percentToPx(watermark.marginPct, edge)
          )
        ]
    for (const point of centers) {
      ctx.save()
      ctx.translate(point.x, point.y)
      ctx.rotate(rad)
      ctx.globalAlpha = alpha
      ctx.drawImage(markImage, -size.width / 2, -size.height / 2, size.width, size.height)
      ctx.restore()
    }
  } catch {
    // 预览失败不阻断主流程（正式处理会给出结构化错误）
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** 追加图片（去重 + 上限 + 体积预警；ObjectURL 供缩略图/预览） */
function addFile(payload: { file: File; path: string }): void {
  invalidHint.value = ''
  if (files.value.some((item) => item.path === payload.path)) return
  if (payload.file.size > MAX_IMAGE_BYTES) {
    invalidHint.value = `图片超过 40MB，已跳过：${payload.file.name}`
    return
  }
  if (files.value.length >= MAX_IMAGES) {
    invalidHint.value = `单次最多 ${MAX_IMAGES} 张图片`
    return
  }
  files.value.push({
    file: payload.file,
    path: payload.path,
    url: URL.createObjectURL(payload.file),
    size: payload.file.size
  })
}

function removeFile(index: number): void {
  const item = files.value[index]
  if (item !== undefined) URL.revokeObjectURL(item.url)
  files.value.splice(index, 1)
}

function clearFiles(): void {
  for (const item of files.value) URL.revokeObjectURL(item.url)
  files.value = []
  invalidHint.value = ''
}

function onWatermarkPicked(payload: { file: File; path: string }): void {
  invalidHint.value = ''
  if (payload.file.size > 5 * 1024 * 1024) {
    invalidHint.value = '水印图片不超过 5MB'
    return
  }
  if (watermarkImage.value !== null) URL.revokeObjectURL(watermarkImage.value.url)
  watermarkImage.value = {
    file: payload.file,
    path: payload.path,
    url: URL.createObjectURL(payload.file),
    size: payload.file.size
  }
}

function clearWatermarkImage(): void {
  if (watermarkImage.value !== null) URL.revokeObjectURL(watermarkImage.value.url)
  watermarkImage.value = null
}

function detach(): void {
  unsubscribe?.()
  unsubscribe = undefined
}

function setError(err: unknown): void {
  error.value = toStructuredError(err)
  phase.value = 'error'
  progress.value = null
}

/** 任务事件：progress → 逐张进度；done → 结果；error → 三态报错 */
function onEvent(event: TaskEvent): void {
  if (event.taskId !== currentTaskId) return
  if (event.kind === 'progress') {
    progress.value = {
      current: event.current,
      total: event.total ?? files.value.length,
      message: event.message ?? event.stage ?? ''
    }
    return
  }
  if (event.kind === 'log') return
  detach()
  progress.value = null
  if (event.kind === 'done') {
    const payload = event.result as WatermarkResult | undefined
    result.value = payload ?? null
    phase.value = 'idle'
    return
  }
  if (event.error.code === 'CANCELLED') {
    phase.value = 'idle'
    return
  }
  error.value = event.error
  phase.value = 'error'
}

async function start(): Promise<void> {
  const watermark = currentWatermark()
  if (watermark === null || files.value.length === 0 || outputDir.value === '') return
  detach()
  currentTaskId = ''
  phase.value = 'running'
  error.value = null
  result.value = null
  showAllOutputs.value = false
  progress.value = { current: 0, total: files.value.length, message: '准备处理…' }
  const payload: WatermarkPayload = {
    inputPaths: files.value.map((item) => item.path),
    watermark,
    outputDir: outputDir.value
  }
  try {
    const { taskId } = await submitWatermark(payload)
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

function resetBatch(): void {
  detach()
  clearFiles()
  result.value = null
  error.value = null
  progress.value = null
  phase.value = 'idle'
}

function retry(): void {
  void start()
}

/** 系统目录选择：选中回填并记忆；取消保持原值 */
async function chooseDir(): Promise<void> {
  try {
    const dir = await pickDirectory('选择输出目录')
    if (dir === null) return
    const saved = await setOutputDir({ outputDir: dir })
    outputDir.value = saved.outputDir
  } catch (err) {
    setError(err)
  }
}

function reveal(): void {
  if (outputDir.value !== '') void revealPath(outputDir.value)
}

onMounted(async () => {
  try {
    const conf = await config()
    outputDir.value = conf.outputDir
  } catch {
    // 读取记忆目录失败不阻断：用户仍可手动选择
  }
})

onUnmounted(() => {
  detach()
  if (previewTimer !== undefined) window.clearTimeout(previewTimer)
  clearFiles()
  clearWatermarkImage()
})
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <header class="flex flex-col gap-1">
      <h2 class="text-lg font-semibold text-[var(--lumin-color-text)]">图片批量水印</h2>
      <p class="text-sm text-[var(--lumin-color-text-secondary)]">
        批量叠加文字或图片水印，原图不修改，全程离线
      </p>
    </header>

    <DropZone
      v-if="files.length === 0"
      :accept="ACCEPT"
      multiple
      hint="拖拽图片到此处，或点击选择（可多选）"
      @select="addFile"
      @invalid="(reason: string) => (invalidHint = reason)"
    />
    <p v-if="files.length === 0" class="text-xs text-[var(--lumin-color-text-secondary)]">
      支持 PNG / JPG / WebP，单次最多 {{ MAX_IMAGES }} 张，单张不超过 40MB。
    </p>

    <p v-if="invalidHint !== ''" class="text-sm text-[var(--lumin-color-error)]">
      {{ invalidHint }}
    </p>

    <template v-if="files.length > 0">
      <section class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-sm text-[var(--lumin-color-text)]">
            已选 {{ files.length }} 张
          </span>
          <div class="flex gap-2">
            <NButton size="small" quaternary @click="clearFiles">
              <template #icon><Trash2 :size="14" /></template>
              清空
            </NButton>
          </div>
        </div>
        <ul class="flex max-h-48 flex-col gap-1 overflow-auto">
          <li
            v-for="(item, index) in files"
            :key="item.path"
            class="flex items-center gap-2 rounded-[var(--lumin-radius-sm)] border border-[var(--lumin-color-border)] px-2 py-1"
          >
            <img
              :src="item.url"
              :alt="item.file.name"
              class="h-8 w-8 rounded-[var(--lumin-radius-sm)] object-cover"
            />
            <span class="flex-1 truncate text-sm text-[var(--lumin-color-text)]">
              {{ item.file.name }}
            </span>
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">
              {{ formatSize(item.size) }}
            </span>
            <NButton size="tiny" quaternary @click="removeFile(index)">
              <template #icon><X :size="12" /></template>
            </NButton>
          </li>
        </ul>
        <DropZone
          v-if="files.length < MAX_IMAGES"
          :accept="ACCEPT"
          multiple
          hint="继续添加图片"
          @select="addFile"
          @invalid="(reason: string) => (invalidHint = reason)"
        />
      </section>

      <section class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <span class="text-sm text-[var(--lumin-color-text)]">水印类型</span>
          <NRadioGroup v-model:value="watermarkType">
            <NRadio value="text">文字水印</NRadio>
            <NRadio value="image">图片水印</NRadio>
          </NRadioGroup>
        </div>

        <template v-if="watermarkType === 'text'">
          <div class="flex flex-col gap-1">
            <span class="text-sm text-[var(--lumin-color-text)]">文字内容</span>
            <NInput v-model:value="text" :maxlength="100" placeholder="输入水印文字（1–100 字）" />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-sm text-[var(--lumin-color-text)]">文字颜色</span>
            <NColorPicker v-model:value="color" :show-alpha="false" class="max-w-40" />
          </div>
        </template>

        <template v-else>
          <div class="flex flex-col gap-1">
            <span class="text-sm text-[var(--lumin-color-text)]">水印图片</span>
            <div v-if="watermarkImage !== null" class="flex items-center gap-2">
              <img
                :src="watermarkImage.url"
                :alt="watermarkImage.file.name"
                class="h-12 w-12 rounded-[var(--lumin-radius-sm)] border border-[var(--lumin-color-border)] object-contain"
              />
              <span class="flex-1 truncate text-sm text-[var(--lumin-color-text)]">
                {{ watermarkImage.file.name }}
              </span>
              <NButton size="small" quaternary @click="clearWatermarkImage">
                <template #icon><X :size="14" /></template>
                移除
              </NButton>
            </div>
            <DropZone
              v-else
              :accept="ACCEPT"
              hint="选择水印图片（PNG / JPG / WebP，≤5MB）"
              @select="onWatermarkPicked"
              @invalid="(reason: string) => (invalidHint = reason)"
            />
          </div>
        </template>

        <div class="flex items-center gap-3">
          <span class="w-24 shrink-0 text-sm text-[var(--lumin-color-text)]">
            {{ sizeOptions.label }} {{ sizeValue }}%
          </span>
          <NSlider v-model:value="sizeValue" :min="sizeOptions.min" :max="sizeOptions.max" :step="1" />
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-sm text-[var(--lumin-color-text)]">
            位置<template v-if="tile">（平铺时忽略）</template>
          </span>
          <div class="grid max-w-56 grid-cols-3 gap-1">
            <NButton
              v-for="item in POSITIONS"
              :key="item"
              size="small"
              :type="position === item ? 'primary' : 'default'"
              :secondary="position !== item"
              :disabled="tile"
              @click="position = item"
            >
              {{ POSITION_LABELS[item] }}
            </NButton>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <span class="w-24 shrink-0 text-sm text-[var(--lumin-color-text)]">边距 {{ marginPct }}%</span>
          <NSlider v-model:value="marginPct" :min="0" :max="20" :step="1" :disabled="tile" />
        </div>

        <div class="flex items-center gap-3">
          <span class="w-24 shrink-0 text-sm text-[var(--lumin-color-text)]">不透明度 {{ opacity }}%</span>
          <NSlider v-model:value="opacity" :min="5" :max="100" :step="1" />
        </div>

        <div class="flex items-center gap-3">
          <span class="w-24 shrink-0 text-sm text-[var(--lumin-color-text)]">旋转</span>
          <NInputNumber v-model:value="rotation" :min="-180" :max="180" :step="5" class="max-w-32">
            <template #suffix>°</template>
          </NInputNumber>
          <span class="flex items-center gap-2 text-sm text-[var(--lumin-color-text)]">
            <NSwitch v-model:value="tile" />
            平铺
          </span>
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <span class="text-sm text-[var(--lumin-color-text)]">预览（第一张）</span>
        <canvas
          ref="previewCanvas"
          class="max-w-full rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)]"
        />
      </section>

      <section class="flex items-center gap-2">
        <NInput :value="outputDir" readonly placeholder="输出目录" class="flex-1" />
        <NButton @click="chooseDir">
          <template #icon><FolderOpen :size="16" /></template>
          选择目录
        </NButton>
      </section>

      <div class="flex flex-wrap items-center gap-2">
        <NButton type="primary" :disabled="!canStart" @click="start">
          <template #icon><Plus :size="16" /></template>
          开始加水印
        </NButton>
        <NButton v-if="result !== null" quaternary @click="resetBatch">再处理一批</NButton>
      </div>

      <TaskProgress
        v-if="phase === 'running' && progress !== null"
        :message="progress.message"
        :current="progress.current"
        :total="progress.total"
        @cancel="onCancel"
      />

      <template v-if="phase === 'error' && error !== null">
        <NAlert type="error" :title="error.message">
          <p class="text-xs opacity-80">
            {{ error.code }}<template v-if="error.detail"> · {{ error.detail }}</template>
          </p>
        </NAlert>
        <div class="flex gap-2">
          <NButton v-if="isRetryable(error.code)" type="primary" @click="retry">重试</NButton>
          <NButton quaternary @click="resetBatch">返回重新选择</NButton>
        </div>
      </template>

      <template v-if="phase === 'idle' && result !== null">
        <NAlert
          :type="result.failures.length === 0 ? 'success' : 'warning'"
          :title="`成功 ${result.outputs.length} 张 · 失败 ${result.failures.length} 张`"
        />
        <ul v-if="result.outputs.length > 0" class="flex flex-col gap-1">
          <li
            v-for="path in result.outputs.slice(0, showAllOutputs ? undefined : 5)"
            :key="path"
            class="break-all text-sm text-[var(--lumin-color-text-secondary)]"
          >
            <PathLink :path="path" :reveal="false" />
          </li>
          <li
            v-if="result.outputs.length > 5 && !showAllOutputs"
            class="text-sm text-[var(--lumin-color-text-secondary)]"
          >
            共 {{ result.outputs.length }} 个文件
            <NButton text type="primary" @click="showAllOutputs = true">查看全部</NButton>
          </li>
        </ul>
        <div v-if="result.outputs.length > 0" class="flex gap-2">
          <NButton quaternary @click="reveal">
            <template #icon><FolderOpen :size="16" /></template>
            打开输出目录
          </NButton>
          <NButton quaternary @click="retry">
            <template #icon><RefreshCw :size="16" /></template>
            再跑一次
          </NButton>
        </div>
        <ul v-if="result.failures.length > 0" class="flex flex-col gap-1">
          <li
            v-for="item in result.failures"
            :key="`${item.file}-${item.code}`"
            class="text-sm text-[var(--lumin-color-error)]"
          >
            {{ item.file }} · {{ item.message }}（{{ item.code }}<template v-if="item.detail"> · {{ item.detail }}</template>）
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>
