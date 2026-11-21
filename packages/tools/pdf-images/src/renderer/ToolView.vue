<script setup lang="ts">
// PDF 图片转换主视图（PDF 逐页转图片 / 图片批量合成 PDF）
// 作者：cuilanchao · 修改时间：2026-11-19
// 三态强制（空态引导 / 加载可取消 / 结构化错误 + 重试）、tokens、@lucide/vue（AGENTS §5）
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  NButton,
  NEmpty,
  NInput,
  NRadioButton,
  NRadioGroup,
  NSpace,
  NTabPane,
  NTabs,
  NText
} from 'naive-ui'
import { ArrowDown, ArrowUp, FileImage, FolderOpen, X } from '@lucide/vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { moveItem } from '../contract'
import { isRetryable } from '../errors'
import {
  MAX_IMAGES,
  MAX_OUTPUT_NAME_LEN,
  type Dpi,
  type OutputImageFormat,
  type PageOrientation,
  type PageSizeMode,
  type PdfImagesFailure
} from '../schema'
import { config, imagesToPdf, pdfInfo, pdfToImages, revealPath, saveOutputDir } from './client'

/** Tab 标识 */
type TabId = 'pdf2img' | 'img2pdf'

/** 任务种类（重试入口据此复放上一次提交） */
type Action = 'pdf2img' | 'img2pdf'

/** DropZone accept 串（与 schema 白名单一致） */
const PDF_ACCEPT = '.pdf'
const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.avif,.gif'

const tab = ref<TabId>('pdf2img')
const outputDir = ref('')

// —— PDF → 图片 ——
const pdfPath = ref('')
const pdfName = ref('')
const pageCount = ref(0)
const inspecting = ref(false)
const ranges = ref('')
const format = ref<OutputImageFormat>('png')
const dpiStr = ref('150')

// —— 图片 → PDF ——
const images = ref<string[]>([])
const pageSize = ref<PageSizeMode>('auto')
const orientation = ref<PageOrientation>('auto')
const marginMm = ref(0)
const outputName = ref('')

/** 页面方向选项（仅固定纸型生效） */
const ORIENTATION_OPTIONS: { label: string; value: PageOrientation }[] = [
  { label: '自动', value: 'auto' },
  { label: '竖版', value: 'portrait' },
  { label: '横版', value: 'landscape' }
]

/** 页边距预设（mm，仅固定纸型生效） */
const MARGIN_PRESETS: { label: string; value: number }[] = [
  { label: '无', value: 0 },
  { label: '小 10mm', value: 10 },
  { label: '中 20mm', value: 20 },
  { label: '大 40mm', value: 40 }
]

/** 固定纸型（A4/Letter）才显示方向与边距 */
const fixedPage = computed(() => pageSize.value !== 'auto')

/** 自定义输出文件名的行内校验（留空合法 = 使用默认命名） */
const outputNameError = computed(() => {
  const raw = outputName.value.trim()
  if (raw === '') return ''
  if (raw.length > MAX_OUTPUT_NAME_LEN) return `输出文件名最长 ${MAX_OUTPUT_NAME_LEN} 字符`
  if (/[\\/:*?"<>|]/.test(raw)) return '输出文件名不能包含 \\ / : * ? " < > |'
  if (/[. ]$/.test(raw)) return '输出文件名不能以点或空格结尾'
  return ''
})

// —— 任务与结果 ——
const phase = ref<'idle' | 'running'>('idle')
const progress = ref<{ current: number; total?: number; message?: string } | null>(null)
const outputs = ref<string[]>([])
const resultFailures = ref<PdfImagesFailure[]>([])
const donePages = ref(0)
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')
const invalidHint = ref('')
const lastAction = ref<Action | null>(null)

let unsubscribe: (() => void) | null = null
let currentTaskId = ''

/** DPI 下拉是字符串，提交前收敛为受支持的数值 */
const dpi = computed<Dpi>(() => (dpiStr.value === '72' ? 72 : dpiStr.value === '300' ? 300 : 150))

/** 去掉目录前缀的文件名（仅展示） */
function fileName(path: string): string {
  return path.replace(/^.*[\\/]/, '')
}

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

/** 行内提示（3s 自动清除） */
function hint(message: string): void {
  invalidHint.value = message
  window.setTimeout(() => {
    invalidHint.value = ''
  }, 3000)
}

function resetResult(): void {
  error.value = null
  errorDetail.value = ''
  outputs.value = []
  resultFailures.value = []
  donePages.value = 0
}

/** 选择 PDF：读取页数（读不到直接进入报错态） */
async function onPickPdf(path: string): Promise<void> {
  resetResult()
  pdfPath.value = path
  pdfName.value = fileName(path)
  pageCount.value = 0
  inspecting.value = true
  try {
    const info = await pdfInfo({ inputPath: path })
    pageCount.value = info.pageCount
    pdfName.value = info.fileName
  } catch (err) {
    pdfPath.value = ''
    showError(err)
  } finally {
    inspecting.value = false
  }
}

function removePdf(): void {
  pdfPath.value = ''
  pdfName.value = ''
  pageCount.value = 0
  resetResult()
}

/** 追加图片：去重 + 上限截断（spec §3.2） */
function onAddImages(paths: string[]): void {
  const known = new Set(images.value)
  const fresh = paths.filter((path) => !known.has(path))
  if (fresh.length === 0) return
  const room = MAX_IMAGES - images.value.length
  if (room <= 0) {
    hint(`单次最多 ${MAX_IMAGES} 张图片`)
    return
  }
  if (fresh.length > room) hint(`单次最多 ${MAX_IMAGES} 张，已忽略多余文件`)
  images.value = [...images.value, ...fresh.slice(0, room)]
  resetResult()
}

function moveImage(index: number, delta: number): void {
  images.value = moveItem(images.value, index, index + delta)
}

function removeImage(path: string): void {
  images.value = images.value.filter((item) => item !== path)
  resetResult()
}

function clearImages(): void {
  images.value = []
  resetResult()
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
      outputs?: string[]
      output?: string
      pages?: number
      failures?: PdfImagesFailure[]
    }
    outputs.value = result.outputs ?? (result.output === undefined ? [] : [result.output])
    resultFailures.value = result.failures ?? []
    donePages.value = result.pages ?? outputs.value.length
    return
  }
  if (event.error.code === 'CANCELLED') return
  error.value = event.error
  errorDetail.value = event.error.detail ?? ''
}

/** 提交任务（三段式第一段返回 taskId，事件按 taskId 过滤） */
async function run(action: Action): Promise<void> {
  resetResult()
  if (action === 'pdf2img' && pdfPath.value === '') {
    error.value = { code: 'PI_INPUT_INVALID', message: '请先添加 PDF 文件' }
    return
  }
  if (action === 'img2pdf' && images.value.length === 0) {
    error.value = { code: 'PI_INPUT_INVALID', message: '请先添加图片文件' }
    return
  }
  lastAction.value = action
  phase.value = 'running'
  progress.value = { current: 0 }
  const dir = outputDir.value.trim()
  try {
    const submit =
      action === 'pdf2img'
        ? pdfToImages({
            inputPath: pdfPath.value,
            ranges: ranges.value.trim(),
            format: format.value,
            dpi: dpi.value,
            ...(dir === '' ? {} : { outputDir: dir })
          })
        : imagesToPdf({
            inputPaths: images.value,
            pageSize: pageSize.value,
            orientation: fixedPage.value ? orientation.value : 'auto',
            marginMm: fixedPage.value ? marginMm.value : 0,
            ...(outputName.value.trim() === '' ? {} : { outputName: outputName.value.trim() }),
            ...(dir === '' ? {} : { outputDir: dir })
          })
    const { taskId } = await submit
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    showError(err)
  }
}

function retry(): void {
  if (lastAction.value !== null && phase.value === 'idle') void run(lastAction.value)
}

async function cancelTask(): Promise<void> {
  if (currentTaskId === '') return
  try {
    await window.lumin.invoke('lumin:task:cancel', { taskId: currentTaskId })
  } catch (err) {
    showError(err)
  }
}

/** 系统目录选择（壳通用能力）：选中回填并记忆，取消保持原值 */
async function chooseDir(): Promise<void> {
  try {
    const dir = await window.lumin.pickDirectory('选择输出目录')
    if (dir === null) return
    outputDir.value = dir
    await saveOutputDir({ outputDir: dir })
  } catch (err) {
    showError(err)
  }
}

function reveal(path: string): void {
  void revealPath(path)
}

function revealAll(): void {
  const first = outputs.value[0]
  if (first !== undefined) void revealPath(first)
}

/** 错误是否给出 [重试]（无副作用错误如输入无效不显示） */
const canRetry = computed(() => error.value !== null && isRetryable(error.value.code))

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
      <h1 class="text-base font-semibold">PDF 图片转换</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        PDF 逐页转图片（PNG / JPG），或把多张图片按顺序合成 PDF
      </p>
    </div>

    <!-- 标签必须走 #tab 插槽：当前 naive-ui 构建下自闭合 pane 的 tab 文本不会渲染 -->
    <NTabs v-model:value="tab" type="line">
      <NTabPane name="pdf2img">
        <template #tab>PDF 转图片</template>
      </NTabPane>
      <NTabPane name="img2pdf">
        <template #tab>图片转 PDF</template>
      </NTabPane>
    </NTabs>

    <p v-if="invalidHint !== ''" class="text-xs text-[var(--lumin-color-warning, #f0a020)]">
      {{ invalidHint }}
    </p>

    <!-- PDF → 图片 -->
    <template v-if="tab === 'pdf2img'">
      <NEmpty
        v-if="pdfPath === '' && phase === 'idle' && error === null"
        description="添加 PDF 开始转换"
      />
      <DropZone
        v-if="pdfPath === ''"
        :accept="PDF_ACCEPT"
        hint="拖入 PDF 文件，或点击选择"
        :disabled="phase === 'running' || inspecting"
        @select="onPickPdf($event.path)"
        @invalid="hint"
      />
      <div
        v-else
        class="flex items-center justify-between rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm">{{ pdfName }}</div>
          <div class="text-xs text-[var(--lumin-color-text-secondary)]">
            <template v-if="inspecting">读取页数中…</template>
            <template v-else>共 {{ pageCount }} 页</template>
          </div>
        </div>
        <NButton size="tiny" quaternary :disabled="phase === 'running'" @click="removePdf">
          <X class="h-3.5 w-3.5" />
        </NButton>
      </div>

      <NSpace vertical :size="12">
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">页码范围</NText>
          <NInput
            v-model:value="ranges"
            :disabled="phase === 'running'"
            placeholder="留空 = 全部页（如 1-3,5）"
            class="flex-1"
          />
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">输出格式</NText>
          <select
            v-model="format"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option value="png">PNG（无损，体积大）</option>
            <option value="jpeg">JPG（有损，体积小）</option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">分辨率</NText>
          <select
            v-model="dpiStr"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option value="72">72 DPI（屏幕预览）</option>
            <option value="150">150 DPI（推荐）</option>
            <option value="300">300 DPI（印刷，较慢）</option>
          </select>
        </div>
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

      <NSpace>
        <NButton
          type="primary"
          :disabled="phase !== 'idle' || pdfPath === '' || inspecting"
          @click="run('pdf2img')"
        >
          开始转换
        </NButton>
      </NSpace>
    </template>

    <!-- 图片 → PDF -->
    <template v-else>
      <NEmpty
        v-if="images.length === 0 && phase === 'idle' && error === null"
        description="添加图片合成 PDF"
      />
      <DropZone
        :accept="IMAGE_ACCEPT"
        :hint="images.length === 0 ? '拖入图片，或点击选择（按列表顺序合成）' : '继续添加'"
        multiple
        :disabled="phase === 'running'"
        @select="onAddImages([$event.path])"
        @invalid="hint"
      />
      <div v-if="images.length > 0" class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <NText depth="2" class="text-sm font-medium">已选 {{ images.length }} 张</NText>
          <NButton
            size="tiny"
            quaternary
            type="error"
            :disabled="phase === 'running'"
            @click="clearImages"
          >
            清空
          </NButton>
        </div>
        <div class="flex max-h-56 flex-col gap-1 overflow-y-auto">
          <div
            v-for="(path, index) in images"
            :key="path"
            class="flex items-center justify-between rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-1.5"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">{{ index + 1 }}. {{ fileName(path) }}</div>
            </div>
            <div class="flex items-center gap-1">
              <NButton
                size="tiny"
                quaternary
                :disabled="phase === 'running' || index === 0"
                @click="moveImage(index, -1)"
              >
                <ArrowUp class="h-3.5 w-3.5" />
              </NButton>
              <NButton
                size="tiny"
                quaternary
                :disabled="phase === 'running' || index === images.length - 1"
                @click="moveImage(index, 1)"
              >
                <ArrowDown class="h-3.5 w-3.5" />
              </NButton>
              <NButton
                size="tiny"
                quaternary
                :disabled="phase === 'running'"
                @click="removeImage(path)"
              >
                <X class="h-3.5 w-3.5" />
              </NButton>
            </div>
          </div>
        </div>
      </div>

      <NSpace vertical :size="12">
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">页面模式</NText>
          <select
            v-model="pageSize"
            :disabled="phase === 'running'"
            class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          >
            <option value="auto">跟随图片尺寸</option>
            <option value="a4">A4（等比居中）</option>
            <option value="letter">Letter（等比居中）</option>
          </select>
        </div>
        <div v-if="fixedPage" class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">页面方向</NText>
          <NRadioGroup v-model:value="orientation" :disabled="phase === 'running'">
            <NRadioButton
              v-for="opt in ORIENTATION_OPTIONS"
              :key="opt.value"
              :value="opt.value"
              :label="opt.label"
            />
          </NRadioGroup>
        </div>
        <div v-if="fixedPage" class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">页边距</NText>
          <NRadioGroup v-model:value="marginMm" :disabled="phase === 'running'">
            <NRadioButton
              v-for="preset in MARGIN_PRESETS"
              :key="preset.value"
              :value="preset.value"
              :label="preset.label"
            />
          </NRadioGroup>
        </div>
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">输出文件名</NText>
            <NInput
              v-model:value="outputName"
              :disabled="phase === 'running'"
              placeholder="留空则用「首图名_合并.pdf」"
              class="flex-1"
            />
            <NText depth="3" class="text-xs">.pdf</NText>
          </div>
          <NText v-if="outputNameError !== ''" type="warning" class="text-xs">
            {{ outputNameError }}
          </NText>
        </div>
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

      <NSpace>
        <NButton
          type="primary"
          :disabled="phase !== 'idle' || images.length === 0 || outputNameError !== ''"
          @click="run('img2pdf')"
        >
          开始合并
        </NButton>
      </NSpace>
    </template>

    <!-- 加载态：进度可见 + 可取消（R4 强制） -->
    <TaskProgress
      v-if="phase === 'running' && progress !== null"
      :message="
        progress.message !== undefined && progress.message !== ''
          ? `处理中 · ${progress.message}`
          : '处理中…'
      "
      :current="progress.current"
      :total="progress.total"
      @cancel="cancelTask"
    />

    <!-- 结果区：成功清单 + 失败汇总 -->
    <div v-if="outputs.length > 0 || resultFailures.length > 0" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <NText depth="2" class="text-sm font-medium">
          完成 {{ donePages }} 页<template v-if="resultFailures.length > 0">
            ，失败 {{ resultFailures.length }} 项</template
          >
        </NText>
        <NButton size="tiny" quaternary @click="revealAll">
          <FolderOpen class="mr-1 h-3.5 w-3.5" />打开所在文件夹
        </NButton>
      </div>
      <div class="flex max-h-64 flex-col gap-1 overflow-y-auto">
        <div
          v-for="path in outputs"
          :key="path"
          class="flex items-center justify-between rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-1.5"
        >
          <div class="min-w-0 flex-1 truncate text-sm">{{ fileName(path) }}</div>
          <NButton size="tiny" quaternary @click="reveal(path)">
            <FolderOpen class="h-3.5 w-3.5" />
          </NButton>
        </div>
        <div
          v-for="fail in resultFailures"
          :key="`${fail.file}-${fail.code}`"
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-error, #e88080)] px-3 py-1.5"
        >
          <NText type="error" class="block truncate text-sm">{{ fileName(fail.file) }}</NText>
          <NText depth="3" class="block text-xs">{{ fail.message }}</NText>
        </div>
      </div>
    </div>

    <!-- 报错态：结构化错误码 → 中文文案 + 重试 / 详情 -->
    <div v-if="error !== null" class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <NText type="error" class="text-sm">
          <FileImage class="mr-1 inline h-3.5 w-3.5" />{{ error.message }}
        </NText>
        <NButton v-if="canRetry" size="tiny" @click="retry">重试</NButton>
      </div>
      <details v-if="errorDetail !== ''">
        <summary class="cursor-pointer text-xs text-[var(--lumin-color-text-secondary)]">
          详情
        </summary>
        <NText depth="3" class="block break-all text-xs">{{ errorDetail }}</NText>
      </details>
    </div>
  </div>
</template>
