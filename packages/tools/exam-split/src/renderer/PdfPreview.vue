<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { NButton, NText } from 'naive-ui'
import { FileUp } from '@lucide/vue'
import type { StructuredError } from '@lumin/shared'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as pdfjs from 'pdfjs-dist'
import { toolError } from '../errors'
import { rangesToText, type CropBox, type PageSize, type PdfRange } from '../preview'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const props = withDefaults(
  defineProps<{
    /** 已选输入文件（预览经 `File.arrayBuffer()` 直读，spec §1；null = 空态） */
    file: File | null
    /** 是否可点选生成区间（合并模式无预览，恒 true） */
    disabled?: boolean
  }>(),
  { disabled: false }
)

const emit = defineEmits<{
  /** 点选/框选生成的规范化区间文本（ToolView 回写文本框，spec §2 双向同步） */
  'range-text': [text: string]
  /** 当前预览页信息（页数 + 当前页尺寸，供区间初校与裁剪 mm 换算） */
  'doc-meta': [meta: { pageCount: number; pageSize: PageSize }]
  /** 预览打开失败（加密/损坏 → 结构化错误卡，spec §6） */
  error: [err: StructuredError]
}>()

/** 高亮区间（ToolView 文本框解析后回写） */
const range = defineModel<PdfRange[]>('range', { default: () => [] })
/** 裁剪框（0–1 比例，当前页参照；null = 无 overlay） */
const crop = defineModel<CropBox | null>('crop', { default: null })

const thumbs = ref<(HTMLElement | null)[]>([])
const loading = ref(false)
const pageCount = ref(0)
const errorText = ref('')
const pages = ref<number[]>([])
/** 当前预览页（1-based；裁剪 mm 换算参照页，spec §1） */
const current = ref(1)
/** 区间锚点（shift 点选扩展用） */
let anchor: number | null = null
let doc: pdfjs.PDFDocumentProxy | null = null
let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null
let renderSeq = 0
let openSeq = 0
let cropDragId = 0

/** 缩略图渲染宽度（CSS px；设备像素比另乘以保证清晰） */
const THUMB_WIDTH = 160

const selectedSet = computed<Set<number>>(() => {
  const set = new Set<number>()
  for (const item of range.value) {
    for (let page = item.start; page <= item.end; page += 1) set.add(page)
  }
  return set
})

async function openFile(file: File | null): Promise<void> {
  dispose()
  if (file === null) return
  const seq = ++openSeq
  loading.value = true
  errorText.value = ''
  pages.value = []
  pageCount.value = 0
  try {
    // 预览读文件走 File.arrayBuffer() 直读（renderer 内，不经 IPC；spec §1）
    const data = new Uint8Array(await file.arrayBuffer())
    if (seq !== openSeq) return
    loadingTask = pdfjs.getDocument({ data })
    const loaded = await loadingTask.promise
    if (seq !== openSeq) return
    doc = loaded
    pageCount.value = loaded.numPages
    pages.value = Array.from({ length: loaded.numPages }, (_, i) => i + 1)
    current.value = 1
    anchor = null
    // 先退出 loading：缩略图 v-for 属 v-else 分支，须挂载（ref 登记）后才可渲染
    loading.value = false
    await nextTick()
    await emitMeta(1)
    await renderVisible()
  } catch (err) {
    if (seq !== openSeq) return
    const code = classifyOpenError(err)
    errorText.value = code
    emit('error', toolError(code, err instanceof Error ? err.message : undefined))
  } finally {
    if (seq === openSeq) loading.value = false
  }
}

/** v-for 缩略图元素登记（经 script 内函数写入，避开模板成员赋值的 ref 解包坑） */
function setThumb(pageNumber: number, el: unknown): void {
  thumbs.value[pageNumber - 1] = el as HTMLElement | null
}

/** 打开失败分类（spec §5：pdfjs PasswordException → PDF_ENCRYPTED） */
function classifyOpenError(err: unknown): 'PDF_ENCRYPTED' | 'PDF_INVALID' | 'PDF_NOT_FOUND' {
  const name = err instanceof Error ? err.name : ''
  if (name === 'PasswordException') return 'PDF_ENCRYPTED'
  if (name === 'InvalidPDFException' || name === 'MissingPDFException') return 'PDF_INVALID'
  return 'PDF_NOT_FOUND'
}

async function emitMeta(pageNumber: number): Promise<void> {
  const currentDoc = doc
  if (currentDoc === null || pageNumber < 1 || pageNumber > currentDoc.numPages) return
  const page = await currentDoc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  emit('doc-meta', {
    pageCount: currentDoc.numPages,
    pageSize: { width: viewport.width, height: viewport.height }
  })
}

/** 可见区缩略图渐进渲染（先当前页，再前后各 4 页；spec §2） */
async function renderVisible(): Promise<void> {
  const currentDoc = doc
  if (currentDoc === null) return
  const seq = ++renderSeq
  const order = [
    current.value,
    ...Array.from(
      { length: 8 },
      (_, i) => current.value + (i % 2 === 0 ? Math.ceil(i / 2) : -Math.ceil(i / 2))
    )
  ].filter((page) => page >= 1 && page <= pageCount.value)
  for (const pageNumber of order) {
    if (seq !== renderSeq || doc !== currentDoc) return
    await renderPage(currentDoc, pageNumber)
  }
}

async function renderPage(currentDoc: pdfjs.PDFDocumentProxy, pageNumber: number): Promise<void> {
  try {
    const canvas = thumbs.value[pageNumber - 1]?.querySelector('canvas')
    if (canvas === null || canvas === undefined || canvas.dataset.rendered === '1') return
    const page = await currentDoc.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const dpr = window.devicePixelRatio || 1
    const scale = (THUMB_WIDTH * dpr) / base.width
    const viewport = page.getViewport({ scale })
    canvas.width = viewport.width
    canvas.height = viewport.height
    // pdfjs v6：canvas 与 canvasContext 互斥，按新 API 只传 canvas
    await page.render({
      canvas,
      viewport
    }).promise
    canvas.dataset.rendered = '1'
  } catch {
    // 文档销毁/渲染取消属于预期竞态，忽略（下次 renderVisible 重试）
  }
}

function dispose(): void {
  renderSeq += 1
  const task = loadingTask
  loadingTask = null
  doc = null
  // loadingTask.destroy() 负责释放 transport/worker 与文档代理（spec §2）
  task?.destroy().catch(() => undefined)
}

/** 点选：普通 = 单页区间；shift = 以锚点扩展（生成规范化文本回写，spec §2） */
function onThumbClick(pageNumber: number, event: MouseEvent): void {
  if (props.disabled) return
  // 局部先算：defineModel 赋值后立即读取会拿到 parent 回传前的旧值
  const next: PdfRange[] = []
  if (event.shiftKey && anchor !== null) {
    next.push({ start: Math.min(anchor, pageNumber), end: Math.max(anchor, pageNumber) })
  } else {
    anchor = pageNumber
    next.push({ start: pageNumber, end: pageNumber })
  }
  range.value = next
  current.value = pageNumber
  emit('range-text', rangesToText(next))
  void emitMeta(pageNumber)
  void renderVisible()
}

function clearRange(): void {
  range.value = []
  anchor = null
  emit('range-text', '')
}

/** 快捷：当前页至末页（生成规范化文本回写，spec §2） */
function selectToEnd(): void {
  const next: PdfRange[] = [{ start: current.value, end: pageCount.value }]
  range.value = next
  emit('range-text', rangesToText(next))
}

/** 裁剪框拖拽（当前页 overlay → 0–1 比例；spec §2） */
function startCropDrag(event: PointerEvent): void {
  if (crop.value === null || props.disabled) return
  const thumb = (event.currentTarget as HTMLElement | null)?.parentElement ?? null
  if (thumb === null) return
  const rect = thumb.getBoundingClientRect()
  const toRatio = (ev: PointerEvent): CropBox => {
    const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height))
    return normalizeBox({ x: startRatio.x, y: startRatio.y }, { x, y })
  }
  const startRatio = {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height
  }
  cropDragId += 1
  const id = cropDragId
  const move = (ev: PointerEvent): void => {
    if (id !== cropDragId) return
    crop.value = toRatio(ev)
  }
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function normalizeBox(a: { x: number; y: number }, b: { x: number; y: number }): CropBox {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

function cropStyle(box: CropBox): Record<string, string> {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.width * 100}%`,
    height: `${box.height * 100}%`
  }
}

const errorLabel = computed(() => {
  switch (errorText.value) {
    case 'PDF_ENCRYPTED':
      return 'PDF 已加密，请先解除密码再操作'
    case 'PDF_INVALID':
      return '文件无法读取（可能已损坏或非 PDF 文件）'
    default:
      return '输入文件不存在，请重新选择'
  }
})

watch(
  () => props.file,
  (file) => {
    void openFile(file)
  },
  { immediate: true }
)

onUnmounted(dispose)
</script>

<template>
  <div class="flex h-full flex-col gap-3">
    <!-- 空态：引导占位（spec §6 禁止白屏） -->
    <div
      v-if="file === null && !loading"
      class="flex min-h-48 flex-col items-center justify-center gap-2 rounded-[var(--lumin-radius-md)] border-2 border-dashed border-[var(--lumin-color-border)] p-6 text-center"
    >
      <FileUp :size="32" class="text-[var(--lumin-color-text-secondary)]" aria-hidden="true" />
      <NText depth="3">选择 PDF 后在此预览页面</NText>
      <NText depth="3" class="text-xs">点选页码生成区间，shift + 点选扩展范围</NText>
    </div>

    <!-- 加载态：骨架占位（spec §6） -->
    <div
      v-else-if="loading"
      class="flex min-h-48 items-center justify-center rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)]"
      role="status"
    >
      <NText depth="3">正在解析 PDF…</NText>
    </div>

    <!-- 报错态（spec §6：预览错误同卡呈现，ToolView 统一渲染卡片，此处仅兜底） -->
    <div
      v-else-if="errorText !== ''"
      class="flex min-h-48 flex-col items-center justify-center gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-danger)] p-6 text-center"
      role="alert"
    >
      <NText type="error">{{ errorLabel }}</NText>
    </div>

    <!-- 缩略图列表 -->
    <div
      v-else
      class="min-h-0 flex-1 overflow-y-auto rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] p-3"
    >
      <div class="flex flex-wrap gap-3">
        <div
          v-for="pageNumber in pages"
          :key="pageNumber"
          :ref="(el) => setThumb(pageNumber, el)"
          class="relative shrink-0 cursor-pointer overflow-hidden rounded border-2 transition-colors"
          :class="
            selectedSet.has(pageNumber)
              ? 'border-blue-500 ring-2 ring-blue-200'
              : 'border-[var(--lumin-color-border)] hover:border-blue-300'
          "
          role="button"
          :aria-label="`第 ${pageNumber} 页`"
          :aria-pressed="selectedSet.has(pageNumber)"
          @click="onThumbClick(pageNumber, $event)"
        >
          <canvas class="block bg-white" :style="{ width: `${THUMB_WIDTH}px` }" />
          <span
            class="absolute right-0 bottom-0 left-0 bg-black/55 px-1 text-center text-xs text-white"
          >
            {{ pageNumber }}
          </span>

          <!-- 裁剪 overlay：仅当前页（spec §2 当前预览页绘制） -->
          <div
            v-if="crop !== null && pageNumber === current && !disabled"
            class="absolute inset-0 cursor-crosshair"
            data-crop-overlay
            @click.stop
            @pointerdown.prevent="startCropDrag($event)"
          >
            <div class="crop-mask" :style="cropStyle(crop)" />
          </div>
        </div>
      </div>
    </div>

    <!-- 区间快捷操作 -->
    <div
      v-if="pages.length > 0"
      class="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="页码选择"
    >
      <NText depth="3" class="text-xs">共 {{ pageCount }} 页</NText>
      <NButton size="tiny" quaternary :disabled="disabled" @click="selectToEnd">
        当前页至末页
      </NButton>
      <NButton size="tiny" quaternary :disabled="disabled" @click="clearRange">清除区间</NButton>
      <NText depth="3" class="text-xs">普通点选 = 单页，shift + 点选 = 扩展</NText>
    </div>
  </div>
</template>

<style scoped>
/* 裁剪遮罩：框外压暗、框内透明（overflow-hidden 限制在当前页内） */
.crop-mask {
  position: absolute;
  box-shadow: 0 0 0 9999px rgb(0 0 0 / 45%);
  border: 2px solid #3b82f6;
}
</style>
