<!--
  @file 文件预览工具主视图（空态/加载态/报错态三态强制）
  @author cuilanchao
  @date 2026-11-22
  @description 按扩展名路由：文本/Markdown/HTML/JSON/CSV/PDF/图片/Office；
               Markdown 与 HTML 走 sandbox iframe + 严格 CSP；PDF 由主进程逐页渲染，
               renderer 只保留 5 页 LRU；Office 触发可取消转换任务。
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NInput } from 'naive-ui'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  RotateCcw,
  ZoomIn,
  ZoomOut
} from '@lucide/vue'
import { parseCsv, toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import { buildHtmlDocument, renderMarkdown } from '@lumin/ui/markdown'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { toolError } from '../errors'
import { FILE_PREVIEW_ACCEPT, type PreviewKind } from '../formats'
import {
  DEFAULT_PAGE_SCALE,
  MAX_PAGE_SCALE,
  MIN_PAGE_SCALE,
  type ConvertOfficeResult,
  type InspectResult,
  type ReadTextResult
} from '../schema'
import {
  assetUrl,
  convertOffice,
  inspect,
  readText,
  releasePreview,
  renderPdfPage,
  setSofficePath,
  sofficeStatus
} from './client'

defineOptions({ name: 'FilePreviewToolView' })

/** 页面阶段：空 / 读取中 / 就绪 / Office 转换中 / 报错 */
type Phase = 'empty' | 'loading' | 'ready' | 'converting' | 'error'

const KIND_LABELS: Record<PreviewKind, string> = {
  text: '文本',
  markdown: 'Markdown',
  html: 'HTML',
  json: 'JSON',
  csv: 'CSV',
  pdf: 'PDF',
  image: '图片',
  office: 'Office'
}

const ENCODING_LABELS: Record<ReadTextResult['encoding'], string> = {
  utf8: 'UTF-8',
  'utf8-bom': 'UTF-8 BOM',
  utf16le: 'UTF-16 LE',
  utf16be: 'UTF-16 BE',
  gbk: 'GBK'
}

/** PDF 页 LRU 容量（spec §5） */
const PAGE_CACHE_SIZE = 5
/** CSV 表格最多渲染行数（首行作表头） */
const CSV_MAX_ROWS = 1000

const phase = ref<Phase>('empty')
const filePath = ref('')
const info = ref<InspectResult | null>(null)
const readResult = ref<ReadTextResult | null>(null)
const errInfo = ref<StructuredError | null>(null)
const invalidHint = ref('')

const viewMode = ref<'preview' | 'source'>('preview')
const markdownPreview = ref('')
const markdownSource = ref('')
const markdownError = ref('')
const htmlPreview = ref('')
const htmlSource = ref('')
const jsonSource = ref('')
const jsonFormatted = ref('')
const jsonParseError = ref('')
const csvSource = ref('')
const csvHeaders = ref<string[]>([])
const csvRows = ref<string[][]>([])
const csvTotalRows = ref(0)
const csvTruncated = ref(false)
const csvError = ref('')
const imageUrl = ref('')

const currentPreviewId = ref('')
const page = ref(1)
const pageInput = ref('1')
const scale = ref(DEFAULT_PAGE_SCALE)
const pageImage = ref('')
const pageLoading = ref(false)
const pageCache = new Map<string, string>()
let renderToken = 0

const progress = ref<{ current: number; total?: number; message: string } | null>(null)
let currentTaskId = ''
let unsubscribe: (() => void) | null = null

const sofficeInput = ref('')
const sofficeFound = ref(false)
const savingSoffice = ref(false)

const kindLabel = computed(() => (info.value === null ? '' : KIND_LABELS[info.value.kind]))
const pageCount = computed(() => info.value?.pageCount ?? 0)
const progressMessage = computed(() => progress.value?.message ?? '转换中…')
const isPdfView = computed(
  () =>
    info.value !== null &&
    (info.value.kind === 'pdf' || info.value.kind === 'office') &&
    info.value.pageCount !== undefined
)

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit] ?? 'B'}`
}

function resetContent(): void {
  readResult.value = null
  viewMode.value = 'preview'
  markdownPreview.value = ''
  markdownSource.value = ''
  markdownError.value = ''
  htmlPreview.value = ''
  htmlSource.value = ''
  jsonSource.value = ''
  jsonFormatted.value = ''
  jsonParseError.value = ''
  csvSource.value = ''
  csvHeaders.value = []
  csvRows.value = []
  csvTotalRows.value = 0
  csvTruncated.value = false
  csvError.value = ''
  imageUrl.value = ''
  page.value = 1
  pageInput.value = '1'
  scale.value = DEFAULT_PAGE_SCALE
  pageImage.value = ''
  pageLoading.value = false
  pageCache.clear()
  progress.value = null
}

function showError(err: unknown): void {
  errInfo.value = toStructuredError(err)
  phase.value = 'error'
}

function detachTask(): void {
  if (unsubscribe !== null) {
    unsubscribe()
    unsubscribe = null
  }
}

async function releaseCurrent(): Promise<void> {
  const previewId = currentPreviewId.value
  currentPreviewId.value = ''
  pageImage.value = ''
  pageCache.clear()
  if (previewId === '') return
  try {
    await releasePreview({ previewId })
  } catch {
    // 释放失败不阻断切换文件
  }
}

/** JSON 解析失败时按 position 推导出错行号 */
function jsonErrorLine(source: string, err: unknown): number | null {
  const message = err instanceof Error ? err.message : String(err)
  const match = /position (\d+)/i.exec(message)
  if (match === null) return null
  const position = Number(match[1])
  if (!Number.isFinite(position)) return null
  return source.slice(0, position).split('\n').length
}

async function loadTextContent(result: InspectResult): Promise<void> {
  const content = await readText({ path: filePath.value })
  readResult.value = content

  if (result.kind === 'markdown') {
    markdownSource.value = content.text
    const rendered = renderMarkdown(content.text)
    if (!rendered.ok) {
      markdownError.value = '内容超过渲染上限，已切换为源码查看'
      viewMode.value = 'source'
      return
    }
    markdownPreview.value = buildHtmlDocument(rendered.value.html, result.name, 'preview')
    return
  }

  if (result.kind === 'html') {
    htmlSource.value = content.text
    htmlPreview.value = buildHtmlDocument(content.text, result.name, 'preview')
    return
  }

  if (result.kind === 'json') {
    jsonSource.value = content.text
    try {
      const parsed: unknown = JSON.parse(content.text)
      jsonFormatted.value = JSON.stringify(parsed, null, 2)
    } catch (err) {
      const line = jsonErrorLine(content.text, err)
      jsonParseError.value = line === null ? 'JSON 解析失败' : `JSON 解析失败（第 ${line} 行）`
      viewMode.value = 'source'
    }
    return
  }

  if (result.kind === 'csv') {
    csvSource.value = content.text
    const parsed = parseCsv(content.text, { delimiter: result.ext === 'tsv' ? '\t' : ',' })
    if (!parsed.ok) {
      csvError.value = parsed.message
      return
    }
    csvHeaders.value = parsed.value.headers ?? []
    csvTotalRows.value = parsed.value.rows.length
    csvRows.value = parsed.value.rows.slice(0, CSV_MAX_ROWS)
    csvTruncated.value = parsed.value.rows.length > CSV_MAX_ROWS
  }
}

async function loadPdfPage(): Promise<void> {
  const previewId = currentPreviewId.value
  if (previewId === '') return
  const key = `${previewId}:${page.value}:${scale.value}`
  const cached = pageCache.get(key)
  if (cached !== undefined) {
    pageImage.value = cached
    pageLoading.value = false
    return
  }
  pageLoading.value = true
  const token = ++renderToken
  try {
    const rendered = await renderPdfPage({ previewId, page: page.value, scale: scale.value })
    if (token !== renderToken) return
    const url = `data:image/png;base64,${rendered.png}`
    pageCache.set(key, url)
    while (pageCache.size > PAGE_CACHE_SIZE) {
      const oldest = pageCache.keys().next().value
      if (oldest === undefined) break
      pageCache.delete(oldest)
    }
    pageImage.value = url
  } catch (err) {
    if (token === renderToken) showError(err)
  } finally {
    if (token === renderToken) pageLoading.value = false
  }
}

async function openFile(path: string): Promise<void> {
  invalidHint.value = ''
  detachTask()
  currentTaskId = ''
  await releaseCurrent()
  resetContent()
  info.value = null
  errInfo.value = null
  filePath.value = path
  phase.value = 'loading'
  try {
    const result = await inspect({ path })
    info.value = result
    if (
      result.kind === 'text' ||
      result.kind === 'markdown' ||
      result.kind === 'html' ||
      result.kind === 'json' ||
      result.kind === 'csv'
    ) {
      await loadTextContent(result)
    } else if (result.kind === 'image') {
      imageUrl.value = (await assetUrl({ path })).url
    } else if (result.kind === 'pdf') {
      currentPreviewId.value = result.previewId
      phase.value = 'ready'
      await loadPdfPage()
      return
    }
    phase.value = 'ready'
  } catch (err) {
    showError(err)
  }
}

/** 任务 done 结果收窄（未知 result → null） */
function asConvertResult(value: unknown): ConvertOfficeResult | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const previewId = record.previewId
  const count = record.pageCount
  if (typeof previewId !== 'string' || previewId === '') return null
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) return null
  return { previewId, pageCount: count }
}

function onTaskEvent(event: TaskEvent): void {
  if (event.taskId !== currentTaskId) return
  if (event.kind === 'progress') {
    progress.value = {
      current: event.current,
      total: event.total,
      message: event.message ?? '转换中…'
    }
    return
  }
  if (event.kind === 'log') return
  detachTask()
  currentTaskId = ''
  progress.value = null
  if (event.kind === 'done') {
    const result = asConvertResult(event.result)
    if (result === null) {
      showError(toolError('FP_CONVERT_FAILED'))
      return
    }
    if (info.value !== null) {
      info.value = { ...info.value, previewId: result.previewId, pageCount: result.pageCount }
    }
    currentPreviewId.value = result.previewId
    page.value = 1
    pageInput.value = '1'
    pageImage.value = ''
    pageCache.clear()
    phase.value = 'ready'
    void loadPdfPage()
    return
  }
  if (event.error.code === 'CANCELLED') {
    phase.value = 'ready'
    return
  }
  errInfo.value = event.error
  phase.value = 'error'
}

async function startConvert(): Promise<void> {
  if (filePath.value === '') return
  errInfo.value = null
  phase.value = 'converting'
  progress.value = { current: 0, total: 100, message: '准备转换…' }
  try {
    const { taskId } = await convertOffice({ path: filePath.value })
    currentTaskId = taskId
    detachTask()
    unsubscribe = window.lumin.onTaskEvent(onTaskEvent)
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

/** 切换文件/卸载时静默取消（避免遗留 soffice 进程与临时 PDF） */
async function cancelSilently(): Promise<void> {
  const taskId = currentTaskId
  if (taskId === '') return
  try {
    await window.lumin.invoke('lumin:task:cancel', { taskId })
  } catch {
    // 取消失败由主进程清理兜底
  }
}

async function retry(): Promise<void> {
  if (filePath.value === '') return
  if (info.value !== null && info.value.kind === 'office' && info.value.pageCount === undefined) {
    await startConvert()
    return
  }
  await openFile(filePath.value)
}

async function saveSoffice(): Promise<void> {
  savingSoffice.value = true
  try {
    const status = await setSofficePath({ path: sofficeInput.value.trim() })
    sofficeFound.value = status.found
    if (status.path !== undefined) sofficeInput.value = status.path
    if (!status.found) {
      errInfo.value = toolError('FP_SOFFICE_MISSING')
      phase.value = 'error'
      return
    }
    errInfo.value = null
    await startConvert()
  } catch (err) {
    showError(err)
  } finally {
    savingSoffice.value = false
  }
}

function onSelect(payload: { file: File; path: string }): void {
  void openFile(payload.path)
}

function onInvalid(reason: string): void {
  invalidHint.value = reason
  window.setTimeout(() => {
    invalidHint.value = ''
  }, 3000)
}

async function pickAnother(): Promise<void> {
  await cancelSilently()
  detachTask()
  currentTaskId = ''
  await releaseCurrent()
  resetContent()
  info.value = null
  errInfo.value = null
  filePath.value = ''
  phase.value = 'empty'
}

function goPage(next: number): void {
  const count = pageCount.value
  if (count < 1) return
  const target = Math.min(count, Math.max(1, next))
  page.value = target
  pageInput.value = String(target)
  void loadPdfPage()
}

function jumpPage(): void {
  const parsed = Number(pageInput.value)
  if (!Number.isFinite(parsed)) {
    pageInput.value = String(page.value)
    return
  }
  goPage(Math.trunc(parsed))
}

function changeScale(delta: number): void {
  const next = Math.min(MAX_PAGE_SCALE, Math.max(MIN_PAGE_SCALE, scale.value + delta))
  scale.value = Math.round(next * 100) / 100
  void loadPdfPage()
}

onMounted(() => {
  void sofficeStatus()
    .then((status) => {
      sofficeFound.value = status.found
      if (status.path !== undefined) sofficeInput.value = status.path
    })
    .catch(() => undefined)
})

onUnmounted(() => {
  void cancelSilently()
  detachTask()
  void releaseCurrent()
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-4">
    <header
      v-if="info !== null"
      class="flex items-start justify-between gap-4 border-b border-[var(--lumin-color-border)] pb-3"
    >
      <div class="min-w-0">
        <h1 class="truncate text-base font-semibold text-[var(--lumin-color-text)]">
          {{ info.name }}
        </h1>
        <p class="mt-1 text-xs text-[var(--lumin-color-text-secondary)]">
          {{ kindLabel }} · {{ formatSize(info.size) }}
          <template v-if="readResult !== null">
            · {{ ENCODING_LABELS[readResult.encoding] }}
            <template v-if="readResult.truncated"> · 已截断（仅前 2MB）</template>
          </template>
        </p>
      </div>
      <NButton size="small" secondary @click="pickAnother">
        <template #icon><Eye :size="16" /></template>
        换一个文件
      </NButton>
    </header>

    <div v-if="phase === 'empty'" class="flex flex-1 flex-col items-center justify-center gap-3">
      <DropZone
        :accept="FILE_PREVIEW_ACCEPT"
        hint="拖拽文件到此处，或点击选择"
        @select="onSelect"
        @invalid="onInvalid"
      />
      <p v-if="invalidHint !== ''" class="text-xs text-[var(--lumin-color-danger)]">
        {{ invalidHint }}
      </p>
    </div>

    <div v-else-if="phase === 'loading'" class="flex flex-1 flex-col gap-3" aria-busy="true">
      <div
        class="h-8 w-1/3 animate-pulse rounded-[var(--lumin-radius-md)] bg-[var(--lumin-color-border)]"
      />
      <div
        class="h-40 animate-pulse rounded-[var(--lumin-radius-lg)] bg-[var(--lumin-color-border)]"
      />
      <div
        class="h-40 animate-pulse rounded-[var(--lumin-radius-lg)] bg-[var(--lumin-color-border)]"
      />
      <p class="text-sm text-[var(--lumin-color-text-secondary)]">正在加载预览…</p>
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
      <div v-if="errInfo.code === 'FP_SOFFICE_MISSING'" class="flex w-full max-w-lg flex-col gap-2">
        <NInput
          v-model:value="sofficeInput"
          size="small"
          placeholder="soffice.com / soffice.exe 完整路径"
          :input-props="{ 'aria-label': 'soffice 路径' }"
        />
        <NButton size="small" type="primary" :loading="savingSoffice" @click="saveSoffice">
          保存路径并重试
        </NButton>
      </div>
      <div class="flex items-center gap-2">
        <NButton v-if="filePath !== ''" size="small" type="primary" @click="retry">
          <template #icon><RotateCcw :size="16" /></template>
          重试
        </NButton>
        <NButton size="small" secondary @click="pickAnother">重新选择</NButton>
      </div>
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col gap-3">
      <TaskProgress
        v-if="phase === 'converting'"
        :message="progressMessage"
        :current="progress?.current"
        :total="progress?.total"
        cancellable
        @cancel="cancelTask"
      />

      <div
        v-else-if="info !== null && info.kind === 'office' && info.pageCount === undefined"
        class="flex flex-1 flex-col items-center justify-center gap-3 rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] p-6 text-center"
      >
        <p class="text-sm text-[var(--lumin-color-text)]">
          Office 文档需先通过 LibreOffice 转换为 PDF 预览
        </p>
        <p v-if="!sofficeFound" class="text-xs text-[var(--lumin-color-text-secondary)]">
          未检测到 LibreOffice，可在报错页指定 soffice 路径
        </p>
        <NButton type="primary" @click="startConvert">转为预览</NButton>
      </div>

      <template v-else-if="info !== null">
        <!-- 纯文本 -->
        <pre
          v-if="info.kind === 'text' && readResult !== null"
          class="min-h-0 flex-1 overflow-auto rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-3 font-mono text-xs whitespace-pre-wrap break-words text-[var(--lumin-color-text)]"
          >{{ readResult.text }}</pre>

        <!-- Markdown -->
        <template v-else-if="info.kind === 'markdown'">
          <div class="flex items-center gap-2">
            <NButton
              size="small"
              :type="viewMode === 'preview' ? 'primary' : 'default'"
              @click="viewMode = 'preview'"
            >
              预览
            </NButton>
            <NButton
              size="small"
              :type="viewMode === 'source' ? 'primary' : 'default'"
              @click="viewMode = 'source'"
            >
              源码
            </NButton>
          </div>
          <p v-if="markdownError !== ''" class="text-xs text-[var(--lumin-color-danger)]">
            {{ markdownError }}
          </p>
          <iframe
            v-if="viewMode === 'preview' && markdownError === ''"
            class="min-h-0 w-full flex-1 rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-white"
            sandbox=""
            referrerpolicy="no-referrer"
            :srcdoc="markdownPreview"
            title="Markdown 预览"
          />
          <pre
            v-else
            class="min-h-0 flex-1 overflow-auto rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-3 font-mono text-xs whitespace-pre-wrap break-words text-[var(--lumin-color-text)]"
            >{{ markdownSource }}</pre>
        </template>

        <!-- HTML -->
        <template v-else-if="info.kind === 'html'">
          <div class="flex items-center gap-2">
            <NButton
              size="small"
              :type="viewMode === 'preview' ? 'primary' : 'default'"
              @click="viewMode = 'preview'"
            >
              预览
            </NButton>
            <NButton
              size="small"
              :type="viewMode === 'source' ? 'primary' : 'default'"
              @click="viewMode = 'source'"
            >
              源码
            </NButton>
          </div>
          <iframe
            v-if="viewMode === 'preview'"
            class="min-h-0 w-full flex-1 rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-white"
            sandbox=""
            referrerpolicy="no-referrer"
            :srcdoc="htmlPreview"
            title="HTML 预览"
          />
          <pre
            v-else
            class="min-h-0 flex-1 overflow-auto rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-3 font-mono text-xs whitespace-pre-wrap break-words text-[var(--lumin-color-text)]"
            >{{ htmlSource }}</pre>
        </template>

        <!-- JSON -->
        <template v-else-if="info.kind === 'json'">
          <div class="flex items-center gap-2">
            <NButton
              size="small"
              :type="viewMode === 'preview' ? 'primary' : 'default'"
              @click="viewMode = 'preview'"
            >
              格式化
            </NButton>
            <NButton
              size="small"
              :type="viewMode === 'source' ? 'primary' : 'default'"
              @click="viewMode = 'source'"
            >
              源码
            </NButton>
          </div>
          <p v-if="jsonParseError !== ''" class="text-xs text-[var(--lumin-color-danger)]">
            {{ jsonParseError }}
          </p>
          <pre
            class="min-h-0 flex-1 overflow-auto rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-3 font-mono text-xs whitespace-pre-wrap break-words text-[var(--lumin-color-text)]"
            >{{
              jsonParseError === '' && viewMode === 'preview' ? jsonFormatted : jsonSource
            }}</pre>
        </template>

        <!-- CSV -->
        <template v-else-if="info.kind === 'csv'">
          <p v-if="csvError !== ''" class="text-xs text-[var(--lumin-color-danger)]">
            {{ csvError }}（已显示原始内容）
          </p>
          <div
            v-if="csvError === ''"
            class="min-h-0 flex-1 overflow-auto rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)]"
          >
            <table class="min-w-full border-collapse text-xs">
              <thead class="sticky top-0 bg-[var(--lumin-color-surface)]">
                <tr>
                  <th
                    v-for="(header, index) in csvHeaders"
                    :key="index"
                    class="border border-[var(--lumin-color-border)] px-2 py-1 text-left font-medium text-[var(--lumin-color-text)]"
                  >
                    {{ header }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rowIndex) in csvRows" :key="rowIndex">
                  <td
                    v-for="(cell, cellIndex) in row"
                    :key="cellIndex"
                    class="border border-[var(--lumin-color-border)] px-2 py-1 text-[var(--lumin-color-text)]"
                  >
                    {{ cell }}
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="csvTruncated" class="p-2 text-xs text-[var(--lumin-color-text-secondary)]">
              仅显示前 {{ CSV_MAX_ROWS }} 行（共 {{ csvTotalRows }} 行）
            </p>
          </div>
          <pre
            v-else
            class="min-h-0 flex-1 overflow-auto rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-3 font-mono text-xs whitespace-pre-wrap break-words text-[var(--lumin-color-text)]"
            >{{ csvSource }}</pre>
        </template>

        <!-- 图片 -->
        <div
          v-else-if="info.kind === 'image'"
          class="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] p-3"
        >
          <img :src="imageUrl" :alt="info.name" class="max-h-full max-w-full object-contain" />
        </div>

        <!-- PDF（含 Office 转换产物） -->
        <template v-else-if="isPdfView">
          <div class="flex flex-wrap items-center gap-2">
            <NButton size="small" :disabled="page <= 1" @click="goPage(page - 1)">
              <template #icon><ChevronLeft :size="16" /></template>
            </NButton>
            <NInput
              v-model:value="pageInput"
              size="small"
              class="w-16"
              :input-props="{ 'aria-label': '页码' }"
              @keyup.enter="jumpPage"
            />
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">/ {{ pageCount }}</span>
            <NButton size="small" :disabled="page >= pageCount" @click="goPage(page + 1)">
              <template #icon><ChevronRight :size="16" /></template>
            </NButton>
            <span class="mx-2 text-xs text-[var(--lumin-color-text-secondary)]"
              >{{ Math.round(scale * 100) }}%</span
            >
            <NButton size="small" :disabled="scale <= MIN_PAGE_SCALE" @click="changeScale(-0.25)">
              <template #icon><ZoomOut :size="16" /></template>
            </NButton>
            <NButton size="small" :disabled="scale >= MAX_PAGE_SCALE" @click="changeScale(0.25)">
              <template #icon><ZoomIn :size="16" /></template>
            </NButton>
          </div>
          <div
            class="flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-3"
          >
            <div
              v-if="pageLoading"
              class="h-[60vh] w-[70%] animate-pulse rounded-[var(--lumin-radius-md)] bg-[var(--lumin-color-border)]"
              aria-busy="true"
            />
            <img
              v-else-if="pageImage !== ''"
              :src="pageImage"
              :alt="`第 ${page} 页`"
              class="max-w-full"
            />
          </div>
        </template>
      </template>
    </div>
  </section>
</template>
