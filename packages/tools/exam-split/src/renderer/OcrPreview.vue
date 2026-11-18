<script setup lang="ts">
/**
 * OCR Tab 左侧预览（spec §10.2）：当前页大图 + 题区 overlay。
 * - 分界线可拖拽（pointer）与键盘微调（↑/↓），Delete 删除；
 * - [添加边界] 进入点击模式（按 x 命中列、y 拆题区）；
 * - 编辑结果为纯函数（`ocr-edit.ts`），回写共享会话（`ocr-workspace.ts`）。
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { NButton, NText } from 'naive-ui'
import { FileText, RotateCcw, RotateCw } from '@lucide/vue'
import { toolError } from '../errors'
import { PDF_RENDER_SCALE } from '../preview'
import type { OcrPage, OcrRegion } from '../schema'
import { classifyPdfOpenError } from './pdf-open'
import { pdfjs } from './pdfjs'
import {
  addBoundary,
  boundaries,
  deleteBoundary,
  ensureRegion,
  moveBoundary,
  numberRegions,
  regionX,
  resolveBoundary,
  type BoundaryInfo,
  type BoundaryRef
} from './ocr-edit'
import { useOcrWorkspace } from './ocr-workspace'

const props = defineProps<{
  /** 已选输入（PDF 或图片；null = 空态） */
  file: File | null
}>()

/** 分界线键盘步长（归一化页高） */
const KEY_STEP = 0.005

const ws = useOcrWorkspace()

const pageBox = ref<HTMLElement | null>(null)
const overlay = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const imgUrl = ref('')
const loading = ref(false)
const errorText = ref('')
const pageCount = ref(0)

let doc: pdfjs.PDFDocumentProxy | null = null
let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null
let openSeq = 0
let renderSeq = 0
let dragId = 0
let suppressClick = false
/** 图片原图（data URL 解码后；旋转预览据此重绘） */
let imageSource: HTMLImageElement | null = null
let sourceUrl = ''

const isPdf = computed(() => props.file !== null && /\.pdf$/i.test(props.file.name))
const pages = computed(() => ws.pages.value)
const pageNumber = computed(() => ws.pageNumber.value)
const selected = computed(() => ws.selected.value)
const adding = computed(() => ws.adding.value)
const activeRegion = computed(() => ws.activeRegion.value)
const disabled = computed(() => ws.running.value !== null)
const startNumber = computed(() => ws.startNumber.value ?? 1)
const rotation = computed(() => ws.rotation.value)
const rotationLabel = computed(() => `旋转 ${rotation.value}°`)

const currentPage = computed<OcrPage | null>(
  () => pages.value.find((page) => page.pageNumber === pageNumber.value) ?? null
)

const currentBoundaries = computed<BoundaryInfo[]>(() => {
  const page = currentPage.value
  return page === null ? [] : boundaries(page)
})

/** 当前页 题区下标 → 连续题号（与右侧列表同源） */
const regionNumbers = computed<Map<number, number>>(() => {
  const map = new Map<number, number>()
  for (const item of numberRegions(pages.value, startNumber.value)) {
    if (item.pageNumber === pageNumber.value) map.set(item.regionIndex, item.number)
  }
  return map
})

const isEmptyPage = computed(
  () => currentPage.value !== null && currentPage.value.regions.length === 0
)

function clearImage(): void {
  imgUrl.value = ''
  imageSource = null
  sourceUrl = ''
}

function dispose(): void {
  renderSeq += 1
  openSeq += 1
  const task = loadingTask
  loadingTask = null
  doc = null
  task?.destroy().catch(() => undefined)
}

/** File → data URL（CSP `img-src` 允许 data:，不放宽 blob:；spec §10.6） */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result !== '') resolve(reader.result)
      else reject(new Error('image-read-failed'))
    }
    reader.onerror = () => reject(new Error('image-read-failed'))
    reader.readAsDataURL(file)
  })
}

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('image-decode-failed'))
    image.src = url
  })
}

/** 旋转后的像素尺寸（90/270 交换宽高；与 worker 侧 `rotatedSize` 同口径） */
function rotatedSize(
  width: number,
  height: number,
  degrees: number
): { width: number; height: number } {
  return degrees === 90 || degrees === 270 ? { width: height, height: width } : { width, height }
}

/**
 * 按旋转角把图片重绘为 data URL（CSP `img-src` 仅 `data:`，不放宽 `blob:`；spec §10.12）。
 * 与 worker 渲染同一几何变换，overlay 归一化坐标因此与导出裁剪一致。
 */
function rotatedDataUrl(image: HTMLImageElement, degrees: number): string {
  const naturalWidth = image.naturalWidth
  const naturalHeight = image.naturalHeight
  const size = rotatedSize(naturalWidth, naturalHeight, degrees)
  const element = document.createElement('canvas')
  element.width = size.width
  element.height = size.height
  const ctx = element.getContext('2d')
  if (ctx === null) return sourceUrl
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.translate(size.width / 2, size.height / 2)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.drawImage(image, -naturalWidth / 2, -naturalHeight / 2, naturalWidth, naturalHeight)
  return element.toDataURL('image/png')
}

/** 应用当前旋转到图片预览（0° 复用原 data URL，避免无谓重编码） */
function applyImageRotation(): void {
  const image = imageSource
  if (image === null) return
  const degrees = rotation.value
  imgUrl.value = degrees === 0 ? sourceUrl : rotatedDataUrl(image, degrees)
  ws.pageSizes.value = {
    ...ws.pageSizes.value,
    1: rotatedSize(image.naturalWidth, image.naturalHeight, degrees)
  }
}

async function open(file: File | null): Promise<void> {
  dispose()
  clearImage()
  errorText.value = ''
  pageCount.value = 0
  ws.previewError.value = null
  if (file === null) return
  const seq = ++openSeq
  loading.value = true
  try {
    if (isPdf.value) {
      // 预览读文件走 File.arrayBuffer() 直读（renderer 内，不经 IPC；同 M3a 预览）
      const data = new Uint8Array(await file.arrayBuffer())
      if (seq !== openSeq) return
      loadingTask = pdfjs.getDocument({ data })
      const loaded = await loadingTask.promise
      if (seq !== openSeq) return
      doc = loaded
      pageCount.value = loaded.numPages
      ws.totalPages.value = loaded.numPages
      loading.value = false
      await nextTick()
      if (seq !== openSeq) return
      await renderPdfPage(pageNumber.value)
      return
    }
    const url = await readAsDataUrl(file)
    const image = await decodeImage(url)
    if (seq !== openSeq) return
    sourceUrl = url
    imageSource = image
    pageCount.value = 1
    ws.totalPages.value = 1
    loading.value = false
    applyImageRotation()
  } catch (err) {
    if (seq !== openSeq) return
    const code = isPdf.value ? classifyPdfOpenError(err) : 'OCR_INPUT_INVALID'
    errorText.value = code
    loading.value = false
    ws.previewError.value = toolError(code, err instanceof Error ? err.message : undefined)
  }
}

/** 渲染当前页（CSS 宽度 × devicePixelRatio；worker 口径尺寸回填会话） */
async function renderPdfPage(target: number): Promise<void> {
  const currentDoc = doc
  const element = canvas.value
  if (currentDoc === null || element === null) return
  const seq = ++renderSeq
  try {
    const page = await currentDoc.getPage(target)
    if (seq !== renderSeq) return
    // 用户旋转叠加页面固有旋转（pdfjs viewport.rotation 为绝对值；与 worker 同口径）
    const pdfRotation = (page.rotate + rotation.value) % 360
    const base = page.getViewport({ scale: PDF_RENDER_SCALE, rotation: pdfRotation })
    const width = Math.max(1, Math.ceil(base.width))
    const height = Math.max(1, Math.ceil(base.height))
    const cssWidth = pageBox.value?.clientWidth ?? 0
    const dpr = window.devicePixelRatio || 1
    const scale = cssWidth > 0 ? (cssWidth * dpr) / base.width : 1
    element.width = Math.max(1, Math.round(base.width * scale))
    element.height = Math.max(1, Math.round(base.height * scale))
    await page.render({
      canvas: element,
      viewport: page.getViewport({ scale, rotation: pdfRotation })
    }).promise
    if (seq !== renderSeq) return
    ws.pageSizes.value = { ...ws.pageSizes.value, [target]: { width, height } }
    ws.totalPages.value = currentDoc.numPages
  } catch {
    // 页面切换/文档销毁属预期竞态（下次渲染重试）
  }
}

function isSelected(ref: BoundaryRef): boolean {
  const value = selected.value
  return (
    value !== null &&
    value.pageNumber === ref.pageNumber &&
    value.columnIndex === ref.columnIndex &&
    value.afterRegion === ref.afterRegion
  )
}

function regionStyle(region: OcrRegion): Record<string, string> {
  const { xStart, xEnd } = regionX(region)
  return {
    left: `${xStart * 100}%`,
    top: `${region.start * 100}%`,
    width: `${(xEnd - xStart) * 100}%`,
    height: `${(region.end - region.start) * 100}%`
  }
}

function pointToRatio(event: MouseEvent | PointerEvent): { x: number; y: number } | null {
  const rect = overlay.value?.getBoundingClientRect()
  if (rect === undefined || rect.width === 0 || rect.height === 0) return null
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  }
}

/** 添加模式点击：按 x 命中列、y 拆题区；非添加模式点击空白 = 取消选中 */
function onOverlayClick(event: MouseEvent): void {
  if (disabled.value || suppressClick) {
    suppressClick = false
    return
  }
  const page = currentPage.value
  const point = pointToRatio(event)
  if (page === null || point === null) return
  if (adding.value) {
    const next = addBoundary(page, point.x, point.y)
    if (next !== page) ws.pages.value = upsert(next)
    return
  }
  ws.activeRegion.value = null
}

/** 用纯函数结果替换当前页（其它页保持不变） */
function upsert(page: OcrPage): OcrPage[] {
  return pages.value.map((item) => (item.pageNumber === page.pageNumber ? page : item))
}

/** 拖动分界线：实时按最新页状态夹取（`ocr-edit.moveBoundary`） */
function startDrag(event: PointerEvent, info: BoundaryInfo): void {
  if (disabled.value) return
  event.preventDefault()
  event.stopPropagation()
  ws.selected.value = info.ref
  const rect = overlay.value?.getBoundingClientRect()
  if (rect === undefined || rect.height === 0) return
  suppressClick = true
  dragId += 1
  const id = dragId
  const target = pageNumber.value
  const move = (ev: PointerEvent): void => {
    if (id !== dragId) return
    const page = pages.value.find((item) => item.pageNumber === target)
    if (page === undefined) return
    const y = (ev.clientY - rect.top) / rect.height
    const next = moveBoundary(page, info.ref, y)
    if (next !== page) ws.pages.value = upsert(next)
  }
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.setTimeout(() => {
      suppressClick = false
    }, 0)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function onBoundaryKey(event: KeyboardEvent, info: BoundaryInfo): void {
  const page = currentPage.value
  if (page === null || disabled.value) return
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    const y = resolveBoundary(page, info.ref)?.y
    if (y === undefined) return
    const next = moveBoundary(page, info.ref, y + (event.key === 'ArrowUp' ? -KEY_STEP : KEY_STEP))
    if (next !== page) ws.pages.value = upsert(next)
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    const next = deleteBoundary(page, info.ref)
    if (next !== page) ws.pages.value = upsert(next)
    ws.selected.value = null
    return
  }
  if (event.key === 'Escape') {
    ws.selected.value = null
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    ws.selected.value = info.ref
  }
}

function deleteSelected(): void {
  const page = currentPage.value
  const ref = selected.value
  if (page === null || ref === null || disabled.value) return
  const next = deleteBoundary(page, ref)
  if (next !== page) ws.pages.value = upsert(next)
  ws.selected.value = null
}

function addRegion(): void {
  const page = currentPage.value
  if (page === null || disabled.value) return
  const next = ensureRegion(page)
  if (next !== page) ws.pages.value = upsert(next)
}

function toggleAdding(): void {
  ws.adding.value = !adding.value
}

/** 题区点击：添加模式下转发给 overlay（题区内点击用于拆分该题） */
function onRegionClick(index: number, event: MouseEvent): void {
  if (adding.value && !disabled.value) {
    onOverlayClick(event)
    return
  }
  selectRegion(index)
}

function selectRegion(index: number): void {
  ws.activeRegion.value = index
}

function selectBoundary(ref: BoundaryRef | null): void {
  ws.selected.value = ref
}

function goPage(delta: number): void {
  const next = pageNumber.value + delta
  if (next < 1 || next > pageCount.value) return
  ws.pageNumber.value = next
  ws.selected.value = null
  ws.activeRegion.value = null
}

watch(
  () => props.file,
  (file) => {
    void open(file)
  },
  { immediate: true }
)

watch(
  () => ws.pageNumber.value,
  (target) => {
    if (!isPdf.value || doc === null || loading.value) return
    void renderPdfPage(target)
  }
)

/** 旋转变更（spec §10.12）：PDF 重渲染当前页；图片按新角度重绘 data URL */
watch(
  () => rotation.value,
  () => {
    if (isPdf.value) {
      if (doc !== null && !loading.value) void renderPdfPage(pageNumber.value)
      return
    }
    applyImageRotation()
  }
)

onUnmounted(() => {
  dispose()
  clearImage()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <!-- 空态：引导占位（spec §10.6 禁止白屏） -->
    <div
      v-if="file === null"
      class="flex min-h-48 flex-1 flex-col items-center justify-center gap-2 rounded-[var(--lumin-radius-md)] border-2 border-dashed border-[var(--lumin-color-border)] p-6 text-center"
    >
      <FileText :size="32" class="text-[var(--lumin-color-text-secondary)]" aria-hidden="true" />
      <NText depth="3">选择试卷图片或 PDF 后在此预览</NText>
      <NText depth="3" class="text-xs">识别后可拖拽、添加或删除题区分界线</NText>
    </div>

    <!-- 加载态（spec §10.6） -->
    <div
      v-else-if="loading"
      class="flex min-h-48 flex-1 items-center justify-center rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)]"
      role="status"
    >
      <NText depth="3">正在加载页面预览…</NText>
    </div>

    <!-- 预览打开失败（结构化错误卡由右侧统一呈现，此处兜底） -->
    <div
      v-else-if="errorText !== ''"
      class="flex min-h-48 flex-1 flex-col items-center justify-center gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-danger)] p-6 text-center"
      role="alert"
    >
      <NText type="error">页面预览失败，请在右侧重新选择文件</NText>
    </div>

    <template v-else>
      <!-- 当前页大图 + overlay -->
      <div
        class="flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] p-3"
      >
        <div ref="pageBox" class="relative w-full max-w-[720px] shrink-0">
          <canvas
            v-show="isPdf"
            ref="canvas"
            class="block h-auto w-full rounded bg-white"
            :class="disabled ? 'opacity-80' : ''"
          />
          <img
            v-if="!isPdf && imgUrl !== ''"
            :src="imgUrl"
            alt="当前页预览"
            class="block h-auto w-full rounded"
            draggable="false"
          />

          <!-- 题区 overlay：坐标与页面图像严格同框（归一化 0–1） -->
          <div
            v-if="currentPage !== null"
            ref="overlay"
            class="absolute inset-0"
            :class="adding ? 'cursor-crosshair' : ''"
            data-ocr-overlay
            @click="onOverlayClick"
          >
            <div
              v-for="(region, index) in currentPage.regions"
              :key="index"
              class="absolute border-2"
              :class="
                activeRegion === index
                  ? 'border-[var(--lumin-color-primary)]'
                  : 'border-[var(--lumin-color-border)]'
              "
              :style="regionStyle(region)"
              @click.stop="onRegionClick(index, $event)"
            >
              <span
                class="absolute top-1 left-1 rounded bg-[var(--lumin-color-primary)] px-1 text-xs leading-4 text-white"
              >
                {{ regionNumbers.get(index) ?? '' }}
              </span>
            </div>

            <!-- 分界线（同列相邻题区公共边；role=slider 支持键盘微调） -->
            <div
              v-for="info in currentBoundaries"
              :key="`${info.ref.columnIndex}-${info.ref.afterRegion}`"
              class="absolute flex h-4 -translate-y-1/2 cursor-row-resize items-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--lumin-color-primary)]"
              :style="{
                top: `${info.y * 100}%`,
                left: `${info.xStart * 100}%`,
                width: `${(info.xEnd - info.xStart) * 100}%`
              }"
              role="slider"
              tabindex="0"
              :aria-label="`第 ${regionNumbers.get(info.prevRegionIndex) ?? ''} 题下边界`"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="Math.round(info.y * 100)"
              :aria-disabled="disabled"
              @pointerdown="startDrag($event, info)"
              @keydown="onBoundaryKey($event, info)"
              @focus="selectBoundary(info.ref)"
            >
              <span
                class="h-[2px] w-full"
                :class="
                  isSelected(info.ref)
                    ? 'bg-[var(--lumin-color-danger)]'
                    : 'bg-[var(--lumin-color-primary)]'
                "
              />
            </div>

            <!-- 空页：一题区都没有（NO_REGIONS 手动模式 / 清空后） -->
            <div
              v-if="isEmptyPage"
              class="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center"
            >
              <NButton size="small" type="primary" :disabled="disabled" @click.stop="addRegion">
                添加题区
              </NButton>
            </div>
          </div>
        </div>
      </div>

      <!-- 工具栏（spec §10.2） -->
      <div class="flex shrink-0 flex-wrap items-center gap-2" role="toolbar" aria-label="题区编辑">
        <div class="flex items-center gap-1">
          <NButton
            size="tiny"
            quaternary
            :disabled="disabled"
            aria-label="向左旋转 90°"
            title="向左旋转 90°"
            @click="ws.rotate(-90)"
          >
            <RotateCcw :size="14" aria-hidden="true" />
          </NButton>
          <NButton
            size="tiny"
            quaternary
            :disabled="disabled"
            aria-label="向右旋转 90°"
            title="向右旋转 90°"
            @click="ws.rotate(90)"
          >
            <RotateCw :size="14" aria-hidden="true" />
          </NButton>
          <NText depth="3" class="text-xs">{{ rotationLabel }}</NText>
        </div>
        <div v-if="pageCount > 1" class="flex items-center gap-1">
          <NButton
            size="tiny"
            quaternary
            :disabled="disabled || pageNumber <= 1"
            aria-label="上一页"
            @click="goPage(-1)"
          >
            ‹
          </NButton>
          <NText depth="3" class="text-xs">第 {{ pageNumber }} / {{ pageCount }} 页</NText>
          <NButton
            size="tiny"
            quaternary
            :disabled="disabled || pageNumber >= pageCount"
            aria-label="下一页"
            @click="goPage(1)"
          >
            ›
          </NButton>
        </div>
        <NButton
          size="tiny"
          :type="adding ? 'primary' : 'default'"
          :disabled="disabled || currentPage === null"
          @click="toggleAdding"
        >
          {{ adding ? '退出添加' : '添加边界' }}
        </NButton>
        <NButton size="tiny" :disabled="disabled || selected === null" @click="deleteSelected">
          删除边界
        </NButton>
        <NButton
          size="tiny"
          :disabled="disabled || currentPage === null"
          @click="ws.resetCurrentPage()"
        >
          重置本页
        </NButton>
        <NText depth="3" class="text-xs">
          {{ adding ? '点击页面插入分界线（Esc 退出）' : '拖拽微调；选中后 ↑/↓ 微调、Delete 删除' }}
        </NText>
      </div>
    </template>
  </div>
</template>
