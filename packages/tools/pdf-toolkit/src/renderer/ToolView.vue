<script setup lang="ts">
// PDF 工具集主视图（合并/拆分/删页/旋转/重排/元数据/水印/页码）
// 作者：cuilanchao · 修改时间：2026-11-19
// 三态强制（空态引导 / 加载可取消 / 结构化错误 + 重试）、tokens、@lucide/vue（AGENTS §5）
import { computed, onUnmounted, reactive, ref } from 'vue'
import { NButton, NEmpty, NInput, NSpace, NTabPane, NTabs, NText } from 'naive-ui'
import { ArrowDown, ArrowUp, Files, FolderOpen, X } from '@lucide/vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import { isRetryable } from '../errors'
import {
  MAX_MERGE_FILES,
  MAX_WATERMARK_TEXT,
  type MetadataPatch,
  type PageNumberPosition,
  type WatermarkPayload
} from '../schema'
import {
  cancelTask as requestCancel,
  deletePages,
  info,
  merge,
  pageNumbers,
  reorder,
  revealPath,
  rotate,
  saveMetadata,
  split,
  watermark
} from './client'
import { rasterizeWatermarkText } from './watermark-text'

/** Tab 标识 */
type TabId =
  | 'merge'
  | 'split'
  | 'delete'
  | 'rotate'
  | 'reorder'
  | 'metadata'
  | 'watermark'
  | 'page-numbers'

/** 任务种类（重试入口据此复放上一次提交） */
type Action = TabId

/** DropZone accept 串（与 schema 白名单一致） */
const PDF_ACCEPT = '.pdf'

/** 水印图片来源 accept 串（与 schema 白名单一致） */
const WATERMARK_IMAGE_ACCEPT = '.png,.jpg,.jpeg'

/** 角度下拉字符串 → 协议数值 */
const DEGREE_MAP = { '90': 90, '180': 180, '270': 270 } as const

/** 页码预设 key → 模板（{n} 当前页，{total} 文档总页数） */
const PN_PRESETS = {
  n: '{n}',
  ratio: '{n}/{total}',
  dash: '- {n} -',
  'page-of': 'Page {n} of {total}'
} as const

type PageNumberPreset = keyof typeof PN_PRESETS | 'custom'

const activeTab = ref<TabId>('merge')

// —— 合并 ——
const mergePaths = ref<string[]>([])

// —— 单文件 Tab 共用输入 ——
const inputPath = ref('')
const inputName = ref('')
const pageCount = ref(0)
const inspecting = ref(false)
const ranges = ref('')
const removeRanges = ref('')
const rotateRanges = ref('')
const degrees = ref<keyof typeof DEGREE_MAP>('90')
const order = ref<number[]>([])
const meta = reactive({ title: '', author: '', subject: '', keywords: '' })

// —— 水印 ——
const wm = reactive({
  kind: 'text' as 'text' | 'image',
  text: '',
  color: '#808080',
  imagePath: '',
  opacity: 40,
  angle: 45,
  scale: 20,
  tile: false,
  ranges: ''
})

// —— 页码 ——
const pn = reactive({
  preset: 'n' as PageNumberPreset,
  customFormat: '',
  position: 'bottom-center' as PageNumberPosition,
  startPage: 1,
  fontSize: 12,
  color: '#333333',
  margin: 24,
  ranges: ''
})

// —— 任务与结果 ——
const phase = ref<'idle' | 'running'>('idle')
const progress = ref<{ current: number; total?: number; message?: string } | null>(null)
const outputs = ref<string[]>([])
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')
const invalidHint = ref('')
const lastAction = ref<Action | null>(null)

let unsubscribe: (() => void) | null = null
let currentTaskId = ''

/** 去掉目录前缀的文件名（仅展示） */
function fileName(path: string): string {
  return path.replace(/^.*[\\/]/, '')
}

/** 元数据至少一项非空（按钮可用性 + 与服务端 refine 同口径） */
const metaFilled = computed(
  () =>
    meta.title.trim() !== '' ||
    meta.author.trim() !== '' ||
    meta.subject.trim() !== '' ||
    meta.keywords.trim() !== ''
)

/** 提交按钮可用性 */
const canSubmit = computed(() => {
  if (phase.value !== 'idle' || inspecting.value) return false
  if (activeTab.value === 'merge') return mergePaths.value.length >= 2
  if (inputPath.value === '') return false
  if (activeTab.value === 'watermark') {
    return wm.kind === 'text' ? wm.text.trim() !== '' : wm.imagePath !== ''
  }
  if (activeTab.value === 'page-numbers') {
    return pn.preset !== 'custom' || pn.customFormat.trim() !== ''
  }
  return activeTab.value !== 'metadata' || metaFilled.value
})

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
}

/** 追加合并文件：大小写不敏感去重 + 上限截断 */
function onAddMerge(paths: string[]): void {
  const known = new Set(mergePaths.value.map((path) => path.toLowerCase()))
  const fresh: string[] = []
  for (const path of paths) {
    const key = path.toLowerCase()
    if (known.has(key)) continue
    known.add(key)
    fresh.push(path)
  }
  if (fresh.length === 0) return
  const room = MAX_MERGE_FILES - mergePaths.value.length
  if (room <= 0) {
    hint(`单次最多 ${MAX_MERGE_FILES} 个文件`)
    return
  }
  if (fresh.length > room) hint(`单次最多 ${MAX_MERGE_FILES} 个，已忽略多余文件`)
  mergePaths.value = [...mergePaths.value, ...fresh.slice(0, room)]
  resetResult()
}

/** 数组内移动（越界返回原数组） */
function moveItem(items: readonly string[], from: number, to: number): string[] {
  if (to < 0 || to >= items.length) return [...items]
  const next = [...items]
  const [item] = next.splice(from, 1)
  if (item === undefined) return next
  next.splice(to, 0, item)
  return next
}

function moveMerge(index: number, delta: number): void {
  mergePaths.value = moveItem(mergePaths.value, index, index + delta)
}

function removeMerge(path: string): void {
  mergePaths.value = mergePaths.value.filter((item) => item !== path)
  resetResult()
}

function clearMerge(): void {
  mergePaths.value = []
  resetResult()
}

/** 选择 PDF：读取页数与元数据（读不到直接进入报错态） */
async function onPick(path: string): Promise<void> {
  resetResult()
  inputPath.value = path
  inputName.value = fileName(path)
  pageCount.value = 0
  inspecting.value = true
  try {
    const result = await info({ inputPath: path })
    pageCount.value = result.pageCount
    inputName.value = result.fileName
    order.value = Array.from({ length: result.pageCount }, (_, index) => index + 1)
    meta.title = result.metadata.title
    meta.author = result.metadata.author
    meta.subject = result.metadata.subject
    meta.keywords = result.metadata.keywords
    pn.startPage = 1
  } catch (err) {
    inputPath.value = ''
    showError(err)
  } finally {
    inspecting.value = false
  }
}

function removeInput(): void {
  inputPath.value = ''
  inputName.value = ''
  pageCount.value = 0
  order.value = []
  resetResult()
}

/** 选择水印图片（仅记录路径，主进程读取） */
function onPickWatermarkImage(path: string): void {
  wm.imagePath = path
  resetResult()
}

/** 重排：上移/下移一位，其余保持不变 */
function movePage(index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= order.value.length) return
  const next = [...order.value]
  const [page] = next.splice(index, 1)
  if (page === undefined) return
  next.splice(target, 0, page)
  order.value = next
}

function resetOrder(): void {
  order.value = Array.from({ length: pageCount.value }, (_, index) => index + 1)
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
    const result = event.result as { outputPaths?: string[] }
    outputs.value = result.outputPaths ?? []
    return
  }
  if (event.error.code === 'CANCELLED') return
  error.value = event.error
  errorDetail.value = event.error.detail ?? ''
}

/** 按当前 Tab 组装载荷并提交（三段式第一段返回 taskId） */
async function submitTask(action: Action): Promise<{ taskId: string }> {
  const path = inputPath.value
  switch (action) {
    case 'merge':
      return merge({ inputPaths: [...mergePaths.value] })
    case 'split':
      return split({ inputPath: path, ranges: ranges.value.trim() })
    case 'delete':
      return deletePages({ inputPath: path, ranges: removeRanges.value.trim() })
    case 'rotate': {
      const text = rotateRanges.value.trim()
      return rotate({
        inputPath: path,
        degrees: DEGREE_MAP[degrees.value],
        ...(text === '' ? {} : { ranges: text })
      })
    }
    case 'reorder':
      return reorder({ inputPath: path, order: [...order.value] })
    case 'metadata': {
      const patch: MetadataPatch = { ...meta }
      return saveMetadata({ inputPath: path, metadata: patch })
    }
    case 'watermark': {
      const shared = {
        inputPath: path,
        opacity: wm.opacity / 100,
        angle: wm.angle,
        scale: wm.scale,
        tile: wm.tile,
        ...(wm.ranges.trim() === '' ? {} : { ranges: wm.ranges.trim() })
      }
      let payload: WatermarkPayload
      if (wm.kind === 'text') {
        const imageData = await rasterizeWatermarkText(wm.text.trim(), wm.color)
        payload = { kind: 'text', imageData, ...shared }
      } else {
        payload = { kind: 'image', imagePath: wm.imagePath, ...shared }
      }
      return watermark(payload)
    }
    case 'page-numbers':
      return pageNumbers({
        inputPath: path,
        format: pn.preset === 'custom' ? pn.customFormat.trim() : PN_PRESETS[pn.preset],
        position: pn.position,
        startPage: pn.startPage,
        fontSize: pn.fontSize,
        color: pn.color.trim(),
        margin: pn.margin,
        ...(pn.ranges.trim() === '' ? {} : { ranges: pn.ranges.trim() })
      })
  }
}

async function run(action: Action): Promise<void> {
  resetResult()
  if (action === 'merge' && mergePaths.value.length < 2) {
    error.value = { code: 'PT_INPUT_INVALID', message: '至少选择 2 个 PDF' }
    return
  }
  if (action !== 'merge' && inputPath.value === '') {
    error.value = { code: 'PT_INPUT_INVALID', message: '请先添加 PDF 文件' }
    return
  }
  lastAction.value = action
  phase.value = 'running'
  progress.value = { current: 0 }
  try {
    const { taskId } = await submitTask(action)
    currentTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    showError(err)
  }
}

function retry(): void {
  if (lastAction.value !== null && phase.value === 'idle') void run(lastAction.value)
}

async function cancel(): Promise<void> {
  if (currentTaskId === '') return
  try {
    await requestCancel(currentTaskId)
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

const canRetry = computed(() => error.value !== null && isRetryable(error.value.code))

onUnmounted(detach)
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">PDF 工具集</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        合并、拆分、删页、旋转、重排、元数据、水印与页码，产物写到源文件同目录
      </p>
    </div>

    <!-- 标签必须走 #tab 插槽：当前 naive-ui 构建下自闭合 pane 的 tab 文本不会渲染 -->
    <NTabs v-model:value="activeTab" type="line">
      <NTabPane name="merge">
        <template #tab>合并</template>
      </NTabPane>
      <NTabPane name="split">
        <template #tab>拆分</template>
      </NTabPane>
      <NTabPane name="delete">
        <template #tab>删页</template>
      </NTabPane>
      <NTabPane name="rotate">
        <template #tab>旋转</template>
      </NTabPane>
      <NTabPane name="reorder">
        <template #tab>重排</template>
      </NTabPane>
      <NTabPane name="metadata">
        <template #tab>元数据</template>
      </NTabPane>
      <NTabPane name="watermark">
        <template #tab>水印</template>
      </NTabPane>
      <NTabPane name="page-numbers">
        <template #tab>页码</template>
      </NTabPane>
    </NTabs>

    <p v-if="invalidHint !== ''" class="text-xs text-[var(--lumin-color-warning, #f0a020)]">
      {{ invalidHint }}
    </p>

    <!-- 合并：多文件有序列表 -->
    <template v-if="activeTab === 'merge'">
      <NEmpty
        v-if="mergePaths.length === 0 && phase === 'idle' && error === null"
        description="添加至少 2 个 PDF 开始合并"
      />
      <DropZone
        :accept="PDF_ACCEPT"
        :hint="mergePaths.length === 0 ? '拖入 PDF（可多选），或点击选择' : '继续添加'"
        multiple
        :disabled="phase === 'running'"
        @select="onAddMerge([$event.path])"
        @invalid="hint"
      />
      <div v-if="mergePaths.length > 0" class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <NText depth="2" class="text-sm font-medium">
            已选 {{ mergePaths.length }} 个（按列表顺序合并）
          </NText>
          <NButton
            size="tiny"
            quaternary
            type="error"
            :disabled="phase === 'running'"
            @click="clearMerge"
          >
            清空
          </NButton>
        </div>
        <div class="flex max-h-56 flex-col gap-1 overflow-y-auto">
          <div
            v-for="(path, index) in mergePaths"
            :key="path"
            class="flex items-center justify-between rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-1.5"
          >
            <div class="min-w-0 flex-1 truncate text-sm">{{ index + 1 }}. {{ fileName(path) }}</div>
            <div class="flex items-center gap-1">
              <NButton
                size="tiny"
                quaternary
                :disabled="phase === 'running' || index === 0"
                @click="moveMerge(index, -1)"
              >
                <ArrowUp class="h-3.5 w-3.5" />
              </NButton>
              <NButton
                size="tiny"
                quaternary
                :disabled="phase === 'running' || index === mergePaths.length - 1"
                @click="moveMerge(index, 1)"
              >
                <ArrowDown class="h-3.5 w-3.5" />
              </NButton>
              <NButton
                size="tiny"
                quaternary
                :disabled="phase === 'running'"
                @click="removeMerge(path)"
              >
                <X class="h-3.5 w-3.5" />
              </NButton>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 其余 Tab：共用单文件输入 -->
    <template v-else>
      <NEmpty
        v-if="inputPath === '' && phase === 'idle' && error === null"
        description="添加 PDF 开始整理"
      />
      <DropZone
        v-if="inputPath === ''"
        :accept="PDF_ACCEPT"
        hint="拖入 PDF 文件，或点击选择"
        :disabled="phase === 'running' || inspecting"
        @select="onPick($event.path)"
        @invalid="hint"
      />
      <div
        v-else
        class="flex items-center justify-between rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm">{{ inputName }}</div>
          <div class="text-xs text-[var(--lumin-color-text-secondary)]">
            <template v-if="inspecting">读取信息中…</template>
            <template v-else>共 {{ pageCount }} 页</template>
          </div>
        </div>
        <NButton size="tiny" quaternary :disabled="phase === 'running'" @click="removeInput">
          <X class="h-3.5 w-3.5" />
        </NButton>
      </div>

      <NSpace vertical :size="12">
        <div v-if="activeTab === 'split'" class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">页码范围</NText>
          <NInput
            v-model:value="ranges"
            :disabled="phase === 'running'"
            placeholder="每段一个文件（如 1-3,5）"
            class="flex-1"
          />
        </div>
        <div v-if="activeTab === 'delete'" class="flex items-center gap-3">
          <NText depth="2" class="w-20 text-sm">删除页码</NText>
          <NInput
            v-model:value="removeRanges"
            :disabled="phase === 'running'"
            placeholder="如 2,4-5（至少保留一页）"
            class="flex-1"
          />
        </div>
        <template v-if="activeTab === 'rotate'">
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">旋转角度</NText>
            <select
              v-model="degrees"
              :disabled="phase === 'running'"
              class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
            >
              <option value="90">顺时针 90°</option>
              <option value="180">顺时针 180°</option>
              <option value="270">顺时针 270°</option>
            </select>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">页码</NText>
            <NInput
              v-model:value="rotateRanges"
              :disabled="phase === 'running'"
              placeholder="留空 = 全部页（如 1-3,5）"
              class="flex-1"
            />
          </div>
        </template>
        <template v-if="activeTab === 'reorder'">
          <div class="flex items-center justify-between">
            <NText depth="2" class="text-sm font-medium">页面顺序（上移 / 下移）</NText>
            <NButton
              size="tiny"
              quaternary
              :disabled="phase === 'running' || pageCount === 0"
              @click="resetOrder"
            >
              重置顺序
            </NButton>
          </div>
          <div v-if="order.length > 0" class="flex max-h-56 flex-col gap-1 overflow-y-auto">
            <div
              v-for="(page, index) in order"
              :key="page"
              class="flex items-center justify-between rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-1.5"
            >
              <div class="text-sm">第 {{ index + 1 }} 位 · 原第 {{ page }} 页</div>
              <div class="flex items-center gap-1">
                <NButton
                  size="tiny"
                  quaternary
                  :disabled="phase === 'running' || index === 0"
                  @click="movePage(index, -1)"
                >
                  <ArrowUp class="h-3.5 w-3.5" />
                </NButton>
                <NButton
                  size="tiny"
                  quaternary
                  :disabled="phase === 'running' || index === order.length - 1"
                  @click="movePage(index, 1)"
                >
                  <ArrowDown class="h-3.5 w-3.5" />
                </NButton>
              </div>
            </div>
          </div>
        </template>
        <template v-if="activeTab === 'metadata'">
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">标题</NText>
            <NInput
              v-model:value="meta.title"
              :disabled="phase === 'running'"
              placeholder="Title"
              class="flex-1"
            />
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">作者</NText>
            <NInput
              v-model:value="meta.author"
              :disabled="phase === 'running'"
              placeholder="Author"
              class="flex-1"
            />
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">主题</NText>
            <NInput
              v-model:value="meta.subject"
              :disabled="phase === 'running'"
              placeholder="Subject"
              class="flex-1"
            />
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">关键词</NText>
            <NInput
              v-model:value="meta.keywords"
              :disabled="phase === 'running'"
              placeholder="Keywords"
              class="flex-1"
            />
          </div>
        </template>
        <template v-if="activeTab === 'watermark'">
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">类型</NText>
            <select
              v-model="wm.kind"
              :disabled="phase === 'running'"
              class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
            >
              <option value="text">文字水印</option>
              <option value="image">图片水印</option>
            </select>
          </div>
          <template v-if="wm.kind === 'text'">
            <div class="flex items-center gap-3">
              <NText depth="2" class="w-20 text-sm">文字</NText>
              <NInput
                v-model:value="wm.text"
                :maxlength="MAX_WATERMARK_TEXT"
                :disabled="phase === 'running'"
                placeholder="如 内部资料（支持中文）"
                class="flex-1"
              />
            </div>
            <div class="flex items-center gap-3">
              <NText depth="2" class="w-20 text-sm">颜色</NText>
              <NInput
                v-model:value="wm.color"
                :disabled="phase === 'running'"
                placeholder="#808080"
                class="w-28"
              />
            </div>
          </template>
          <template v-else>
            <DropZone
              v-if="wm.imagePath === ''"
              :accept="WATERMARK_IMAGE_ACCEPT"
              hint="拖入 PNG/JPG 图片，或点击选择"
              :disabled="phase === 'running'"
              @select="onPickWatermarkImage($event.path)"
              @invalid="hint"
            />
            <div
              v-else
              class="flex items-center justify-between rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
            >
              <div class="min-w-0 flex-1 truncate text-sm">{{ fileName(wm.imagePath) }}</div>
              <NButton
                size="tiny"
                quaternary
                :disabled="phase === 'running'"
                @click="wm.imagePath = ''"
              >
                <X class="h-3.5 w-3.5" />
              </NButton>
            </div>
          </template>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">透明度</NText>
            <input
              v-model.number="wm.opacity"
              type="range"
              min="5"
              max="100"
              step="5"
              :disabled="phase === 'running'"
              class="flex-1"
            />
            <NText depth="3" class="w-10 text-right text-xs">{{ wm.opacity }}%</NText>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">角度</NText>
            <input
              v-model.number="wm.angle"
              type="range"
              min="-90"
              max="90"
              step="15"
              :disabled="phase === 'running'"
              class="flex-1"
            />
            <NText depth="3" class="w-10 text-right text-xs">{{ wm.angle }}°</NText>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">大小</NText>
            <input
              v-model.number="wm.scale"
              type="range"
              min="5"
              max="50"
              step="5"
              :disabled="phase === 'running'"
              class="flex-1"
            />
            <NText depth="3" class="w-10 text-right text-xs">{{ wm.scale }}%</NText>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">平铺</NText>
            <label class="flex items-center gap-1 text-sm">
              <input v-model="wm.tile" type="checkbox" :disabled="phase === 'running'" />
              铺满整页
            </label>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">页码范围</NText>
            <NInput
              v-model:value="wm.ranges"
              :disabled="phase === 'running'"
              placeholder="留空 = 全部页（如 1-3,5）"
              class="flex-1"
            />
          </div>
        </template>
        <template v-if="activeTab === 'page-numbers'">
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">格式</NText>
            <select
              v-model="pn.preset"
              :disabled="phase === 'running'"
              class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
            >
              <option value="n">1</option>
              <option value="ratio">1/N</option>
              <option value="dash">- 1 -</option>
              <option value="page-of">Page 1 of N</option>
              <option value="custom">自定义</option>
            </select>
            <NInput
              v-if="pn.preset === 'custom'"
              v-model:value="pn.customFormat"
              :disabled="phase === 'running'"
              placeholder="如 {n} / {total}（仅英文数字符号）"
              class="flex-1"
            />
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">位置</NText>
            <select
              v-model="pn.position"
              :disabled="phase === 'running'"
              class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
            >
              <option value="bottom-center">底部居中</option>
              <option value="bottom-left">左下角</option>
              <option value="bottom-right">右下角</option>
              <option value="top-center">顶部居中</option>
              <option value="top-left">左上角</option>
              <option value="top-right">右上角</option>
            </select>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">起始页</NText>
            <input
              v-model.number="pn.startPage"
              type="number"
              min="1"
              :max="Math.max(pageCount, 1)"
              :disabled="phase === 'running'"
              class="w-24 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
            />
            <NText depth="3" class="text-xs">从该页起编号 1</NText>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">字号</NText>
            <input
              v-model.number="pn.fontSize"
              type="number"
              min="8"
              max="32"
              :disabled="phase === 'running'"
              class="w-24 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
            />
            <NText depth="2" class="ml-4 w-12 text-sm">颜色</NText>
            <NInput
              v-model:value="pn.color"
              :disabled="phase === 'running'"
              placeholder="#333333"
              class="w-28"
            />
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">边距</NText>
            <input
              v-model.number="pn.margin"
              type="number"
              min="12"
              max="72"
              :disabled="phase === 'running'"
              class="w-24 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
            />
            <NText depth="3" class="text-xs">pt（12–72）</NText>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">页码范围</NText>
            <NInput
              v-model:value="pn.ranges"
              :disabled="phase === 'running'"
              placeholder="留空 = 全部页（如 1-3,5）"
              class="flex-1"
            />
          </div>
        </template>
      </NSpace>
    </template>

    <NSpace>
      <NButton type="primary" :disabled="!canSubmit" @click="run(activeTab)">
        {{
          activeTab === 'merge'
            ? '开始合并'
            : activeTab === 'split'
              ? '开始拆分'
              : activeTab === 'delete'
                ? '开始删页'
                : activeTab === 'rotate'
                  ? '开始旋转'
                  : activeTab === 'reorder'
                    ? '开始重排'
                    : activeTab === 'watermark'
                      ? '添加水印'
                      : activeTab === 'page-numbers'
                        ? '添加页码'
                        : '保存元数据'
        }}
      </NButton>
    </NSpace>

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
      @cancel="cancel"
    />

    <!-- 结果区 -->
    <div v-if="outputs.length > 0" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <NText depth="2" class="text-sm font-medium">完成，共 {{ outputs.length }} 个文件</NText>
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
      </div>
    </div>

    <!-- 报错态：结构化错误码 → 中文文案 + 重试 / 详情 -->
    <div v-if="error !== null" class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <NText type="error" class="text-sm">
          <Files class="mr-1 inline h-3.5 w-3.5" />{{ error.message }}
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
