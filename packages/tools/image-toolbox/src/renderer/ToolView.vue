<script setup lang="ts">
// 图片工具箱主视图（M6 一期：压缩/转换/缩放三 Tab；M70 合并旋转/裁剪；M72 合并水印/去水印/拼接；M82 合并文字识别/二维码）
// 作者：cuilanchao · 修改时间：2026-11-25
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
import {
  ArrowDownAZ,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  FolderPlus,
  History,
  Images,
  X
} from '@lucide/vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import TaskProgress from '@lumin/ui/TaskProgress.vue'
import PathLink from '@lumin/ui/PathLink.vue'
import {
  appendHistory,
  clearHistory,
  collectFolder,
  config,
  makeGif,
  process,
  probe,
  revealPath,
  saveOutputDir
} from './client'
import { planGifCanvas } from '../gif'
import { MAX_BATCH_FILES, extensionOf } from '../schema'
import type {
  CropAnchor,
  CropMode,
  CropOptions,
  Flip,
  HistoryEntry,
  HistoryMode,
  MakeGifResult,
  OutputItem,
  ProbeItem,
  Rotation,
  TargetFormat
} from '../schema'
import WatermarkTab from './tabs/WatermarkTab.vue'
import DewatermarkTab from './tabs/DewatermarkTab.vue'
import StitchTab from './tabs/StitchTab.vue'
import OcrTab from './tabs/OcrTab.vue'
import QrTab from './tabs/QrTab.vue'

/** Tab 标识（spec §2；M40 增补 effect/gif；M70 §4.48 合并 rotate/crop；M72 §4.72 合并水印/去水印/拼接） */
type TabId =
  | 'compress'
  | 'convert'
  | 'resize'
  | 'rotate'
  | 'crop'
  | 'effect'
  | 'gif'
  | 'watermark'
  | 'dewatermark'
  | 'stitch'
  | 'ocr'
  | 'qr'

/** 原有 7 个页签（共享同一套文件列表与输出目录 UI；M72 新增三页签自带独立视图） */
const LEGACY_TABS: readonly TabId[] = [
  'compress',
  'convert',
  'resize',
  'rotate',
  'crop',
  'effect',
  'gif'
]

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

/** 旋转选项（顺时针；M70 §4.48，spec §2.6） */
const ROTATION_OPTIONS: { label: string; value: Rotation }[] = [
  { label: '不旋转', value: 'none' },
  { label: '顺时针 90°', value: '90' },
  { label: '180°', value: '180' },
  { label: '顺时针 270°', value: '270' }
]

/** 翻转选项（M70 §4.48，spec §2.6） */
const FLIP_OPTIONS: { label: string; value: Flip }[] = [
  { label: '不翻转', value: 'none' },
  { label: '水平翻转', value: 'horizontal' },
  { label: '垂直翻转', value: 'vertical' }
]

/** 裁剪比例预设（w:h；custom 走自定义输入；M70 §4.48，spec §2.7） */
const RATIO_PRESETS = [
  { key: '1:1', label: '1:1', w: 1, h: 1 },
  { key: '4:3', label: '4:3', w: 4, h: 3 },
  { key: '3:4', label: '3:4', w: 3, h: 4 },
  { key: '16:9', label: '16:9', w: 16, h: 9 },
  { key: '9:16', label: '9:16', w: 9, h: 16 },
  { key: 'custom', label: '自定义', w: 1, h: 1 }
] as const

type RatioKey = (typeof RATIO_PRESETS)[number]['key']

/** 九宫格锚点（比例模式：裁剪窗口在图片中的位置，spec §2.7） */
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

// —— Tab 与参数（spec §2 默认值） ——
const tab = ref<TabId>('compress')
/** 当前是否原有页签（决定共享文件列表区显隐；M72 新页签各自渲染独立视图） */
const isLegacyTab = computed(() => LEGACY_TABS.includes(tab.value))
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
// 旋转（M70 §4.48，spec §2.6）
const rotation = ref<Rotation>('none')
const flip = ref<Flip>('none')
// 裁剪（M70 §4.48，spec §2.7）
const cropMode = ref<CropMode>('ratio')
const ratioKey = ref<RatioKey>('1:1')
const customW = ref<number | null>(1)
const customH = ref<number | null>(1)
const cropAnchor = ref<CropAnchor>('center')
const freeX = ref<number | null>(0)
const freeY = ref<number | null>(0)
const freeW = ref<number | null>(100)
const freeH = ref<number | null>(100)
// 调整（M40，spec §2.4）
const effectKind = ref<'grayscale' | 'invert' | 'binary'>('grayscale')
const effectThreshold = ref(128)
const effectQuality = ref(75)
// 调色（M55 §4.55）：0 = 不生效
const effectBrightness = ref(0)
const effectContrast = ref(0)
const effectSaturation = ref(0)
const effectSharpen = ref(0)
const effectBlur = ref(0)

/** 调色一键复位（M55 §4.55） */
function resetAdjust(): void {
  effectBrightness.value = 0
  effectContrast.value = 0
  effectSaturation.value = 0
  effectSharpen.value = 0
  effectBlur.value = 0
}
// GIF（M40，spec §2.5）
const gifDuration = ref(500)
const gifLoop = ref(0)
const gifWidth = ref(0)
const gifResult = ref<MakeGifResult | null>(null)

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
/** 文件夹递归收集中的提示（M63） */
const folderHint = ref('')
const collecting = ref(false)
/** 处理历史（最近 20 条，新 → 旧；M63） */
const history = ref<HistoryEntry[]>([])

// —— 任务与结果 ——
const phase = ref<'idle' | 'running'>('idle')
const progress = ref<{ current: number; total?: number; message?: string } | null>(null)
const results = ref<OutputItem[]>([])
const resultFailures = ref<{ input: string; message: string }[]>([])
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')

let unsubscribe: (() => void) | null = null
let currentTaskId = ''
/** 当前运行的任务类型（done 结果形状不同：process 批量结果 / gif 单文件结果） */
const taskKind = ref<'process' | 'gif'>('process')
/** 当前运行任务的模式（写入处理历史用；M63） */
let taskMode: HistoryMode = 'compress'

/** 处理模式中文名（历史列表展示；M63） */
const MODE_LABEL: Record<HistoryMode, string> = {
  compress: '压缩',
  convert: '格式转换',
  resize: '缩放',
  rotate: '旋转',
  crop: '裁剪',
  effect: '效果',
  gif: 'GIF 合成'
}

/** 历史时间戳格式化（本地时区，24 小时制） */
function formatHistoryTime(at: number): string {
  return new Date(at).toLocaleString('zh-CN', { hour12: false })
}

/** 写入一条处理历史（失败不影响主流程；M63） */
function recordHistory(
  mode: HistoryMode,
  success: number,
  failed: number,
  firstOutput: string | null
): void {
  const dir = outputDir.value.trim()
  void appendHistory({
    mode,
    success,
    failed,
    outputDir: dir === '' ? '默认目录' : dir,
    firstOutput
  })
    .then((result) => {
      history.value = result.history
    })
    .catch(() => undefined)
}

/** 无损格式忽略质量：对应 Tab 的质量滑杆置灰（spec §2.2） */
const compressIsLossless = computed(() => LOSSLESS_FORMATS.has(compressTarget.value))
const convertIsLossless = computed(() => LOSSLESS_FORMATS.has(convertFormat.value))
const resizeIsLossless = computed(() => LOSSLESS_FORMATS.has(resizeFormat.value))
/** 调整沿用原格式：全部输入为 png/bmp/tiff 时质量无效（spec §2.4） */
const effectIsLossless = computed(
  () =>
    rows.value.length > 0 &&
    rows.value.every((row) => LOSSLESS_FORMATS.has(extensionOf(row.file) ?? ''))
)

/** 旋转/翻转至少选一项（M70 §4.48，spec §2.6 禁用规则） */
const hasRotateOperation = computed(() => rotation.value !== 'none' || flip.value !== 'none')

/** 裁剪比例参数（自定义时取输入值，空值回退 1） */
const ratioBox = computed(() => {
  const preset = RATIO_PRESETS.find((item) => item.key === ratioKey.value)
  if (preset !== undefined && preset.key !== 'custom') return { w: preset.w, h: preset.h }
  return { w: Math.max(1, customW.value ?? 1), h: Math.max(1, customH.value ?? 1) }
})

/** 自由裁剪区域（百分比；空值回退默认） */
const freeBox = computed(() => ({
  x: freeX.value ?? 0,
  y: freeY.value ?? 0,
  width: Math.max(1, freeW.value ?? 100),
  height: Math.max(1, freeH.value ?? 100)
}))

/** 自由区域必须落在图片内（spec §2.7 禁用规则） */
const freeValid = computed(
  () =>
    freeBox.value.x + freeBox.value.width <= 100 && freeBox.value.y + freeBox.value.height <= 100
)

/** 开始按钮禁用：旋转需选操作、自由裁剪需区域合法（M70 §4.48） */
const startDisabled = computed(() => {
  if (phase.value !== 'idle' || rows.value.length === 0) return true
  if (tab.value === 'rotate') return !hasRotateOperation.value
  if (tab.value === 'crop') return cropMode.value === 'free' && !freeValid.value
  return false
})

/** GIF 自动高度（全部帧按目标宽等比缩放后的最大高；尺寸未就绪时 null） */
const gifCanvas = computed(() => {
  if (rows.value.length === 0 || rows.value.some((row) => row.width <= 0)) return null
  return planGifCanvas(
    rows.value.map((row) => ({ width: row.width, height: row.height })),
    gifWidth.value
  )
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
  gifResult.value = null
}

/** GIF 帧顺序：上移/下移（spec §2.5 行内 [↑][↓]） */
function moveRow(index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= rows.value.length) return
  const list = [...rows.value]
  const current = list[index]
  const swap = list[target]
  if (current === undefined || swap === undefined) return
  list[index] = swap
  list[target] = current
  rows.value = list
}

/** 按文件名排序（GIF 帧顺序，spec §2.5） */
function sortByName(): void {
  rows.value = [...rows.value].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
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
    if (taskKind.value === 'gif') {
      const gif = (event.result as MakeGifResult | undefined) ?? null
      gifResult.value = gif
      if (gif !== null) recordHistory('gif', 1, 0, gif.outputPath)
      return
    }
    const result = event.result as {
      outputs?: OutputItem[]
      failures?: { input: string; message: string }[]
    }
    results.value = result.outputs ?? []
    resultFailures.value = result.failures ?? []
    recordHistory(
      taskMode,
      results.value.length,
      resultFailures.value.length,
      results.value[0]?.output ?? null
    )
    return
  }
  if (event.error.code === 'CANCELLED' || event.error.code === 'IT_CANCELLED') return
  error.value = event.error
  errorDetail.value = event.error.detail ?? ''
}

/** 原有页签 → 历史模式（新页签不走共享处理链路，gif 复用 compress 模式） */
function legacyModeOf(current: TabId): HistoryMode {
  switch (current) {
    case 'convert':
    case 'resize':
    case 'rotate':
    case 'crop':
    case 'effect':
      return current
    default:
      return 'compress'
  }
}

/** 提交批量处理（spec §2 参数 → payload discriminated union） */
async function runProcess(): Promise<void> {
  error.value = null
  errorDetail.value = ''
  results.value = []
  resultFailures.value = []
  gifResult.value = null
  if (rows.value.length === 0) {
    error.value = { code: 'IT_NO_FILES', message: '请先添加图片文件' }
    return
  }
  taskKind.value = 'process'
  taskMode = legacyModeOf(tab.value)
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

/** 提交 GIF 生成（M40，spec §2.5：1–100 张，顺序即帧顺序） */
async function runGif(): Promise<void> {
  error.value = null
  errorDetail.value = ''
  results.value = []
  resultFailures.value = []
  gifResult.value = null
  if (rows.value.length === 0) {
    error.value = { code: 'IT_NO_FILES', message: '请先添加图片文件' }
    return
  }
  if (gifCanvas.value === null) {
    error.value = {
      code: 'IT_GIF_TOO_LARGE',
      message: 'GIF 尺寸超出上限，请减小宽度或图片数量'
    }
    return
  }
  taskKind.value = 'gif'
  phase.value = 'running'
  progress.value = { current: 0, total: rows.value.length, message: '读取尺寸' }
  try {
    const { taskId } = await makeGif({
      files: rows.value.map((row) => row.file),
      outputDir: outputDir.value.trim(),
      options: {
        durationMs: gifDuration.value,
        loop: gifLoop.value,
        width: gifWidth.value
      }
    })
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
  if (tab.value === 'rotate') {
    return {
      mode: 'rotate' as const,
      files,
      outputDir: dir,
      options: { rotation: rotation.value, flip: flip.value }
    }
  }
  if (tab.value === 'crop') {
    return {
      mode: 'crop' as const,
      files,
      outputDir: dir,
      options: buildCropOptions()
    }
  }
  if (tab.value === 'effect') {
    return {
      mode: 'effect' as const,
      files,
      outputDir: dir,
      options: {
        effect: effectKind.value,
        threshold: effectThreshold.value,
        quality: effectQuality.value,
        brightness: effectBrightness.value,
        contrast: effectContrast.value,
        saturation: effectSaturation.value,
        sharpen: effectSharpen.value,
        blur: effectBlur.value
      }
    }
  }
  return {
    mode: 'resize' as const,
    files,
    outputDir: dir,
    options: buildResizeOptions()
  }
}

/** 裁剪参数（未使用字段填默认值，schema 允许；M70 §4.48，spec §2.7） */
function buildCropOptions(): CropOptions {
  if (cropMode.value === 'ratio') {
    return {
      mode: 'ratio',
      ratioW: ratioBox.value.w,
      ratioH: ratioBox.value.h,
      anchor: cropAnchor.value,
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

/** 递归添加文件夹内图片（M63，P1-6）：白名单过滤 + 去重合并 + 上限提示 */
async function addFolder(): Promise<void> {
  invalidHint.value = ''
  folderHint.value = ''
  let dir: string | null = null
  try {
    dir = await window.lumin.pickDirectory('选择图片文件夹')
  } catch (err) {
    showError(err)
    return
  }
  if (dir === null) return
  collecting.value = true
  try {
    const result = await collectFolder({ dir })
    const room = MAX_BATCH_FILES - rows.value.length
    if (room <= 0) {
      folderHint.value = `列表已达 ${MAX_BATCH_FILES} 张上限，请先移除部分图片`
      return
    }
    const before = rows.value.length
    await onAdd(result.files.slice(0, room))
    const added = rows.value.length - before
    if (result.truncated) {
      folderHint.value = `已达 ${MAX_BATCH_FILES} 张上限，仅收集部分图片（新增 ${added} 张）`
    } else if (added === 0) {
      folderHint.value = '所选文件夹内的图片已在列表中'
    } else {
      folderHint.value = `已从文件夹新增 ${added} 张图片`
    }
  } catch (err) {
    showError(err)
  } finally {
    collecting.value = false
  }
}

/** 清空处理历史（M63） */
async function clearAllHistory(): Promise<void> {
  try {
    const result = await clearHistory()
    history.value = result.history
  } catch (err) {
    showError(err)
  }
}

onMounted(() => {
  void config()
    .then((result) => {
      outputDir.value = result.outputDir
      history.value = result.history
    })
    .catch((err) => showError(err))
})

onUnmounted(detach)
</script>

<template>
  <div class="flex max-w-5xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">图片工具箱</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        批量压缩、格式转换、缩放、效果调整、GIF 生成、批量水印、去水印、图片拼接、图片/PDF
        文字识别与二维码生成识别；本地离线执行
      </p>
    </div>

    <!-- Tab：压缩/转换/缩放/调整/GIF/水印/去水印/拼接（切换不丢文件列表与输出目录） -->
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
      <NTabPane name="rotate">
        <template #tab>旋转</template>
      </NTabPane>
      <NTabPane name="crop">
        <template #tab>裁剪</template>
      </NTabPane>
      <NTabPane name="effect">
        <template #tab>调整</template>
      </NTabPane>
      <NTabPane name="gif">
        <template #tab>GIF</template>
      </NTabPane>
      <NTabPane name="watermark">
        <template #tab>水印</template>
      </NTabPane>
      <NTabPane name="dewatermark">
        <template #tab>去水印</template>
      </NTabPane>
      <NTabPane name="stitch">
        <template #tab>拼接</template>
      </NTabPane>
      <NTabPane name="ocr">
        <template #tab>文字识别</template>
      </NTabPane>
      <NTabPane name="qr">
        <template #tab>二维码</template>
      </NTabPane>
    </NTabs>

    <!-- 原有 7 页签共享区（v-show 保留文件列表与在跑任务状态） -->
    <div v-show="isLegacyTab" class="flex max-w-3xl flex-col gap-4">
      <!-- 文件列表区（空态 = 拖拽引导；非空时 DropZone 收窄为追加入口） -->
      <NEmpty
        v-if="rows.length === 0 && phase === 'idle' && error === null"
        description="添加图片开始处理"
      />
      <DropZone
        :accept="ACCEPT"
        :hint="
          rows.length === 0
            ? tab === 'gif'
              ? '拖入图片作为 GIF 帧，或点击选择（顺序即帧顺序）'
              : '拖入图片，或点击选择（支持 jpg/png/webp/avif/gif/bmp/tiff）'
            : '继续添加'
        "
        multiple
        :disabled="phase === 'running'"
        @select="onAdd([$event.path])"
        @invalid="onInvalid"
      />
      <NText v-if="invalidHint !== ''" type="warning" class="text-xs">{{ invalidHint }}</NText>
      <div class="flex flex-wrap items-center gap-2">
        <NButton
          size="small"
          secondary
          data-testid="add-folder"
          :disabled="phase === 'running' || collecting"
          @click="addFolder"
        >
          <FolderPlus class="mr-1 h-4 w-4" />{{ collecting ? '正在收集…' : '添加文件夹' }}
        </NButton>
        <NText depth="3" class="text-xs"
          >递归收集子目录内支持的图片（上限 {{ MAX_BATCH_FILES }} 张）</NText
        >
      </div>
      <NText v-if="folderHint !== ''" depth="3" class="text-xs" data-testid="folder-hint">
        {{ folderHint }}
      </NText>
      <div v-if="rows.length > 0" class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <NText depth="2" class="text-sm font-medium">
            已选 {{ rows.length }} 张<template v-if="probing"> · 读取信息中…</template>
          </NText>
          <div class="flex items-center gap-1">
            <NButton
              v-if="tab === 'gif'"
              size="tiny"
              quaternary
              data-testid="sort-by-name"
              :disabled="phase === 'running' || rows.length < 2"
              @click="sortByName"
            >
              <ArrowDownAZ class="mr-1 h-3.5 w-3.5" />按文件名排序
            </NButton>
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
            <div class="flex items-center gap-1">
              <template v-if="tab === 'gif'">
                <NButton
                  size="tiny"
                  quaternary
                  data-testid="row-up"
                  :disabled="phase === 'running'"
                  @click="moveRow(rows.indexOf(row), -1)"
                >
                  <ChevronUp class="h-3.5 w-3.5" />
                </NButton>
                <NButton
                  size="tiny"
                  quaternary
                  data-testid="row-down"
                  :disabled="phase === 'running'"
                  @click="moveRow(rows.indexOf(row), 1)"
                >
                  <ChevronDown class="h-3.5 w-3.5" />
                </NButton>
              </template>
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
        <template v-else-if="tab === 'resize'">
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
        <template v-else-if="tab === 'rotate'">
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">旋转</NText>
            <select
              v-model="rotation"
              :disabled="phase === 'running'"
              class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
            >
              <option v-for="opt in ROTATION_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">翻转</NText>
            <select
              v-model="flip"
              :disabled="phase === 'running'"
              class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
            >
              <option v-for="opt in FLIP_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
          <NText depth="3" class="text-xs">先翻转后旋转；旋转与翻转至少选一项</NText>
        </template>
        <template v-else-if="tab === 'crop'">
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">裁剪方式</NText>
            <select
              v-model="cropMode"
              :disabled="phase === 'running'"
              class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
            >
              <option value="ratio">比例裁剪</option>
              <option value="free">自由裁剪</option>
            </select>
          </div>
          <template v-if="cropMode === 'ratio'">
            <div class="flex items-center gap-3">
              <NText depth="2" class="w-20 text-sm">比例</NText>
              <select
                v-model="ratioKey"
                :disabled="phase === 'running'"
                class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
              >
                <option v-for="opt in RATIO_PRESETS" :key="opt.key" :value="opt.key">
                  {{ opt.label }}
                </option>
              </select>
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
              <select
                v-model="cropAnchor"
                :disabled="phase === 'running'"
                class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
              >
                <option v-for="opt in ANCHOR_OPTIONS" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>
            <NText depth="3" class="text-xs">按所选比例取原图内最大矩形，位置由九宫格决定</NText>
          </template>
          <template v-else>
            <div class="flex flex-wrap items-center gap-3">
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
            <NText v-if="!freeValid" type="warning" class="text-xs"> 裁剪区域超出图片范围 </NText>
            <NText v-else depth="3" class="text-xs">
              按图片尺寸的百分比取区域（左+宽、上+高 ≤ 100）
            </NText>
          </template>
        </template>
        <template v-else-if="tab === 'effect'">
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">效果</NText>
            <select
              v-model="effectKind"
              data-testid="effect-kind"
              :disabled="phase === 'running'"
              class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
            >
              <option value="grayscale">灰度</option>
              <option value="invert">反色</option>
              <option value="binary">黑白二值</option>
            </select>
            <NText depth="3" class="text-xs">输出沿用原格式</NText>
          </div>
          <div v-if="effectKind === 'binary'" class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">二值阈值</NText>
            <NSlider
              v-model:value="effectThreshold"
              data-testid="effect-threshold"
              :min="0"
              :max="255"
              :disabled="phase === 'running'"
              class="flex-1"
            />
            <span class="w-10 text-right text-sm">{{ effectThreshold }}</span>
          </div>
          <!-- 调色（M55 §4.55）：0 = 不生效，与效果叠加 -->
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">调色</NText>
            <NButton
              size="tiny"
              quaternary
              data-testid="adjust-reset"
              :disabled="phase === 'running'"
              @click="resetAdjust"
            >
              复位
            </NButton>
            <NText depth="3" class="text-xs">0 = 不生效，可与效果叠加</NText>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">亮度</NText>
            <NSlider
              v-model:value="effectBrightness"
              data-testid="adjust-brightness"
              :min="-100"
              :max="100"
              :disabled="phase === 'running'"
              class="flex-1"
            />
            <span class="w-10 text-right text-sm">{{ effectBrightness }}</span>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">对比度</NText>
            <NSlider
              v-model:value="effectContrast"
              data-testid="adjust-contrast"
              :min="-100"
              :max="100"
              :disabled="phase === 'running'"
              class="flex-1"
            />
            <span class="w-10 text-right text-sm">{{ effectContrast }}</span>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">饱和度</NText>
            <NSlider
              v-model:value="effectSaturation"
              data-testid="adjust-saturation"
              :min="-100"
              :max="100"
              :disabled="phase === 'running'"
              class="flex-1"
            />
            <span class="w-10 text-right text-sm">{{ effectSaturation }}</span>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">锐化</NText>
            <NSlider
              v-model:value="effectSharpen"
              data-testid="adjust-sharpen"
              :min="0"
              :max="100"
              :disabled="phase === 'running'"
              class="flex-1"
            />
            <span class="w-10 text-right text-sm">{{ effectSharpen }}</span>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">模糊</NText>
            <NSlider
              v-model:value="effectBlur"
              data-testid="adjust-blur"
              :min="0"
              :max="100"
              :disabled="phase === 'running'"
              class="flex-1"
            />
            <span class="w-10 text-right text-sm">{{ effectBlur }}</span>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">质量</NText>
            <NSlider
              v-model:value="effectQuality"
              :min="1"
              :max="100"
              :disabled="phase === 'running' || effectIsLossless"
              class="flex-1"
            />
            <span class="w-10 text-right text-sm">{{ effectQuality }}</span>
          </div>
        </template>
        <template v-else-if="tab === 'gif'">
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">帧时长</NText>
            <NInputNumber
              v-model:value="gifDuration"
              data-testid="gif-duration"
              :min="50"
              :max="5000"
              :step="50"
              :disabled="phase === 'running'"
              class="w-40"
            >
              <template #suffix>ms</template>
            </NInputNumber>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">循环</NText>
            <select
              v-model.number="gifLoop"
              data-testid="gif-loop"
              :disabled="phase === 'running'"
              class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
            >
              <option :value="0">无限</option>
              <option :value="-1">不循环</option>
              <option v-for="n in [2, 3, 4, 5, 6, 7, 8, 9, 10]" :key="n" :value="n">
                {{ n }} 次
              </option>
            </select>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">宽度</NText>
            <NInputNumber
              v-model:value="gifWidth"
              data-testid="gif-width"
              :min="0"
              :max="4096"
              :step="64"
              :disabled="phase === 'running'"
              class="w-40"
            >
              <template #suffix>px</template>
            </NInputNumber>
            <NText depth="3" class="text-xs">0 = 按首张图片宽</NText>
          </div>
          <div class="flex items-center gap-3">
            <NText depth="2" class="w-20 text-sm">高度</NText>
            <span data-testid="gif-height" class="text-sm">
              {{ gifCanvas === null ? '—' : `${gifCanvas.height} px` }}
            </span>
            <NText depth="3" class="text-xs">按目标宽等比缩放后的最大高（自动）</NText>
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
        <NButton
          v-if="tab === 'gif'"
          type="primary"
          data-testid="gif-run"
          :disabled="phase !== 'idle' || rows.length === 0 || gifCanvas === null"
          @click="runGif"
        >
          生成 GIF
        </NButton>
        <NButton v-else type="primary" :disabled="startDisabled" @click="runProcess">
          开始处理
        </NButton>
      </NSpace>

      <!-- 加载态：进度可见 + 可取消（R4 强制） -->
      <TaskProgress
        v-if="phase === 'running' && progress !== null"
        :message="
          progress.message !== '' && progress.message !== undefined
            ? `${taskKind === 'gif' ? '生成 GIF' : '处理'}中 · ${progress.message}`
            : taskKind === 'gif'
              ? '生成 GIF 中…'
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
            <div class="truncate text-sm">
              <PathLink
                :path="item.output"
                :label="item.output.replace(/^.*[\\/]/, '')"
                :reveal="false"
              />
            </div>
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

      <!-- GIF 结果（M40）：单文件 + 尺寸/帧数/体积 + 打开目录 -->
      <div
        v-if="gifResult !== null"
        data-testid="gif-result"
        class="flex flex-col gap-1 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
      >
        <div class="flex items-center justify-between">
          <NText depth="2" class="text-sm font-medium">
            已生成 {{ gifResult.frames }} 帧 · {{ gifResult.width }}×{{ gifResult.height }} ·
            {{ formatBytes(gifResult.sizeBytes) }}
          </NText>
          <NButton size="tiny" quaternary @click="revealPath(gifResult.outputPath)">
            <FolderOpen class="mr-1 h-3.5 w-3.5" />打开所在文件夹
          </NButton>
        </div>
        <PathLink :path="gifResult.outputPath" :reveal="false" />
      </div>

      <!-- 处理历史（M63，P1-6）：最近 20 条，可定位首个产物 / 清空 -->
      <details
        v-if="history.length > 0"
        data-testid="history-panel"
        class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
      >
        <summary class="flex cursor-pointer items-center justify-between text-sm">
          <span class="flex items-center gap-1">
            <History class="h-4 w-4" />处理历史（最近 {{ history.length }} 条）
          </span>
          <NButton size="tiny" quaternary type="error" @click.prevent="clearAllHistory">
            清空历史
          </NButton>
        </summary>
        <div class="mt-2 flex flex-col gap-1">
          <div
            v-for="(entry, index) in history"
            :key="`${entry.at}-${index}`"
            class="flex items-center justify-between gap-2 rounded-[var(--lumin-radius-sm)] px-1 py-1"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs">
                {{ formatHistoryTime(entry.at) }} · {{ MODE_LABEL[entry.mode] }} · 成功
                {{ entry.success
                }}<template v-if="entry.failed > 0"> · 失败 {{ entry.failed }}</template>
              </div>
              <div class="truncate text-xs">
                <PathLink :path="entry.outputDir" :reveal="false" />
              </div>
            </div>
            <NButton
              v-if="entry.firstOutput !== null"
              size="tiny"
              quaternary
              @click="revealPath(entry.firstOutput)"
            >
              <FolderOpen class="h-3.5 w-3.5" />
            </NButton>
          </div>
        </div>
      </details>

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

    <!-- M72：水印 / 去水印 / 拼接三页签（各自独立视图与任务，v-show 保留状态） -->
    <WatermarkTab v-show="tab === 'watermark'" />
    <DewatermarkTab v-show="tab === 'dewatermark'" />
    <StitchTab v-show="tab === 'stitch'" />
    <!-- M82：文字识别 / 二维码两页签（各自独立视图与任务，v-show 保留状态） -->
    <OcrTab v-show="tab === 'ocr'" />
    <QrTab v-show="tab === 'qr'" />
  </div>
</template>
