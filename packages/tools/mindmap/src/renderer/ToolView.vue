<script setup lang="ts">
/**
 * @file 思维导图工具页（单页三态 + 工具栏 + 画布/大纲双视图 + 状态栏 + 样式抽屉）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 空态引导 / 加载态可取消 / 报错态结构化码；导图与大纲同一文档双向同步，
 *              节点操作条 + 搜索定位 + 从文本生成降低录入成本；本地文件与草稿走 8 条 IPC 通道。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NColorPicker,
  NDrawer,
  NDrawerContent,
  NIcon,
  NInput,
  NModal,
  NSelect,
  NSpin,
  NSwitch
} from 'naive-ui'
import {
  ArrowDown,
  ArrowUp,
  ChevronsDownUp,
  ChevronsUpDown,
  CornerUpLeft,
  Download,
  FileDown,
  FilePlus,
  FileText,
  FolderOpen,
  ImageDown,
  Keyboard,
  ListPlus,
  ListTree,
  Maximize,
  MessageSquare,
  Moon,
  Network,
  Palette,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  SaveAll,
  Search,
  Sun,
  Trash,
  Undo2,
  ZoomIn,
  ZoomOut
} from '@lucide/vue'
import mindElixirCss from 'mind-elixir/style.css?inline'
import type { StructuredError } from '@lumin/shared'
import { toStructuredError } from '@lumin/shared'

import {
  MAX_NODES,
  countNodes,
  createDocument,
  directionLabel,
  normalizeDirection,
  sanitizeDocument,
  searchNodes,
  serializeDocument,
  type MindmapDirection,
  type MindmapDocument,
  type NodeSearchHit
} from '../contract'
import { errorMessage, isRetryable, toolError } from '../errors'
import { exportMarkdown, importMarkdown, importOutlineText } from '../markdown'
import { exportOpml, importOpml } from '../opml'
import {
  buildTheme,
  readThemeTokens,
  themeCssText,
  type ThemeMode,
  type ThemeTokens
} from '../theme'
import {
  clearDraft,
  loadDraft,
  openDialog,
  openDocument,
  readTextFile,
  saveDocument,
  saveDraft,
  writeExport
} from './client'
import {
  buildRasterSvg,
  buildSvgDocument,
  blobToBase64,
  collectStageRects,
  computeExportBox,
  rasterizePng,
  resolveExportSize,
  type ExportBox,
  type RasterNode
} from './export-image'
import {
  createMindElixir,
  type MindElixirHandle,
  type NodeStyleSnapshot,
  type OutlinerHandle
} from './mind-elixir-adapter'

type Phase = 'empty' | 'ready'
type ErrorAction = 'open' | 'import' | 'save' | 'export' | 'draft' | null
type PendingAction = 'new' | 'open' | 'import-markdown' | 'import-opml' | 'text-replace'
type ImportKind = 'markdown' | 'opml'
type ExportKind = 'json' | 'markdown' | 'opml'
type ImageFormat = 'png' | 'svg'
type ImageBackground = 'theme' | 'white' | 'transparent'
type ViewMode = 'map' | 'outline'
type NodeAction = 'child' | 'sibling' | 'parent' | 'up' | 'down' | 'remove'
type BorderWidth = '0' | '1' | '2'

const phase = ref<Phase>('empty')
const booting = ref(false)
const busy = ref('')
const instanceReady = ref(false)
const errInfo = ref<StructuredError | null>(null)
const errorAction = ref<ErrorAction>(null)
const retryAvailable = ref(false)
const notice = ref<string[]>([])

const canvasHost = ref<HTMLDivElement | null>(null)
const emptyTopic = ref('中心主题')
const currentPath = ref('')
const currentName = ref('')
const currentMtimeMs = ref<number | null>(null)
const dirty = ref(false)
const nodeCount = ref(0)
const zoomPercent = ref(100)
const direction = ref<MindmapDirection>(2)
const themeMode = ref<ThemeMode>('light')

const draftSavedAt = ref('')
const draftInfo = ref<{ savedAt: string; documentPath?: string; data: unknown } | null>(null)
const draftCorrupt = ref(false)
const draftPaused = ref(false)

const confirmVisible = ref(false)
const pendingAction = ref<PendingAction>('new')
const fileChangedVisible = ref(false)
const imageModalVisible = ref(false)
const imageFormat = ref<ImageFormat>('png')
const imageScale = ref<1 | 2 | 3>(2)
const imageBackground = ref<ImageBackground>('theme')
const exportCancelVisible = ref(false)

const drawerVisible = ref(false)
const selectedNode = ref<NodeStyleSnapshot | null>(null)
const styleBackground = ref('')
const styleColor = ref('')
const styleBorderWidth = ref<BorderWidth>('0')
const styleBorderColor = ref('#4f46e5')
const styleFontSize = ref<number | null>(null)
const styleBold = ref(false)
const styleBranchColor = ref('')

const viewMode = ref<ViewMode>('map')
const outlineHost = ref<HTMLDivElement | null>(null)
const selectionCount = ref(0)
const searchWrap = ref<HTMLDivElement | null>(null)
const searchKeyword = ref('')
const searchResults = ref<NodeSearchHit[]>([])
const helpVisible = ref(false)
const noteVisible = ref(false)
const noteDraft = ref('')
const linkDraft = ref('')
const textVisible = ref(false)
const textDraft = ref('')
const textMode = ref<'append' | 'replace'>('append')

let handle: MindElixirHandle | null = null
let outliner: OutlinerHandle | null = null
let retryOp: (() => Promise<void>) | null = null
let pendingText = ''
let draftTimer: ReturnType<typeof setTimeout> | undefined
let draftDeadline = 0
let suppressDirty = false
let exportController: AbortController | null = null
let themeObserver: MutationObserver | null = null
let lastImportKind: ImportKind = 'markdown'

const toolbarDisabled = computed(() => busy.value !== '' || booting.value || !instanceReady.value)
const directionOptions = [
  { label: '左右', value: 2 },
  { label: '右侧', value: 1 },
  { label: '左侧', value: 0 },
  { label: '向下', value: 3 }
]
const imageFormatOptions = [
  { label: 'PNG', value: 'png' },
  { label: 'SVG', value: 'svg' }
]
const imageScaleOptions = [
  { label: '1×', value: 1 },
  { label: '2×', value: 2 },
  { label: '3×', value: 3 }
]
const imageBackgroundOptions = [
  { label: '主题背景', value: 'theme' },
  { label: '白色', value: 'white' },
  { label: '透明', value: 'transparent' }
]
const borderWidthOptions = [
  { label: '无边框', value: '0' },
  { label: '细（1px）', value: '1' },
  { label: '粗（2px）', value: '2' }
]
const fontSizeOptions = [
  { label: '默认', value: 0 },
  ...[14, 16, 18, 20, 24, 28, 32].map((size) => ({ label: `${String(size)} px`, value: size }))
]
const textModeOptions = [
  { label: '追加到选中节点', value: 'append' },
  { label: '替换当前导图', value: 'replace' }
]
const shortcutGroups: { title: string; items: { keys: string; desc: string }[] }[] = [
  {
    title: '节点编辑',
    items: [
      { keys: 'Tab', desc: '新增子节点' },
      { keys: 'Enter', desc: '新增同级节点' },
      { keys: 'F2 / 双击', desc: '编辑节点文字' },
      { keys: 'Delete', desc: '删除选中节点' },
      { keys: '方向键', desc: '在节点间移动' }
    ]
  },
  {
    title: '视图与查找',
    items: [
      { keys: 'Ctrl + F', desc: '搜索主题与备注' },
      { keys: 'Ctrl + O', desc: '打开导图文件' },
      { keys: 'Ctrl + 0', desc: '适应窗口' },
      { keys: 'Ctrl + /', desc: '打开 / 关闭本帮助' }
    ]
  },
  {
    title: '文件',
    items: [
      { keys: 'Ctrl + S', desc: '保存' },
      { keys: 'Ctrl + Shift + S', desc: '另存为' },
      { keys: 'Ctrl + N', desc: '新建导图' }
    ]
  }
]

/** 当前明暗模式（仅读 html[data-theme]，不做组件内主题分支） */
function readThemeMode(): ThemeMode {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/** 读取 tokens（getComputedStyle 注入，便于测试替换） */
function cssReader(variable: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variable)
}

/** tokens 快照 */
function readTokens(): ThemeTokens {
  return readThemeTokens(cssReader)
}

/** 路径末段文件名 */
function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/** 相对时间文案（草稿保存时间） */
function formatRelative(iso: string): string {
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return '刚刚'
  const diff = Date.now() - time
  if (diff < 60_000) return '刚刚'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${String(minutes)} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时前`
  return `${String(Math.floor(hours / 24))} 天前`
}

/** 结构化错误入口 */
function fail(err: unknown, action: ErrorAction, op: (() => Promise<void>) | null = null): void {
  errInfo.value = toStructuredError(err)
  errorAction.value = action
  retryOp = op
  retryAvailable.value = op !== null && isRetryable(errInfo.value.code)
}

/** 重试最近失败操作 */
function retryLast(): void {
  const op = retryOp
  retryOp = null
  retryAvailable.value = false
  if (op !== null) void op()
}

/** 重新选择文件（打开/导入失败） */
function reselectFile(): void {
  errInfo.value = null
  if (errorAction.value === 'import') {
    chooseImportFile(lastImportKind)
    return
  }
  void requestOpen()
}

/** 显式错误提示（非 IO 类） */
function warn(message: string): void {
  notice.value = [message]
}

/** 统计节点数 / 缩放并同步状态栏 */
function refreshStats(): void {
  if (handle === null) return
  nodeCount.value = countNodes(handle.getData())
  zoomPercent.value = handle.getScalePercent()
}

/** 干净的文档状态（载入后重置脏标记） */
function markClean(): void {
  dirty.value = false
  draftSavedAt.value = ''
  refreshStats()
}

/** 编辑事件：标脏 + 统计 + 草稿防抖 */
function handleDirty(): void {
  if (suppressDirty) return
  dirty.value = true
  refreshStats()
  scheduleDraft()
}

/** 布局方向变化 */
function handleDirection(value: number): void {
  direction.value = normalizeDirection(value)
}

/** 选择变化：同步节点操作条与样式面板 */
function handleSelect(): void {
  selectionCount.value = handle?.getSelectionCount() ?? 0
  if (drawerVisible.value) syncSelection()
}

/** 主题色（默认边框色取自 tokens，避免硬编码色值） */
function defaultBorderColor(): string {
  const primary = readTokens().primary.trim()
  return primary === '' ? '#4f46e5' : primary
}

/** 销毁大纲视图 */
function destroyOutliner(): void {
  outliner?.destroy()
  outliner = null
}

/** 创建大纲视图（同一文档、共享撤销栈） */
async function createOutliner(): Promise<void> {
  destroyOutliner()
  const host = outlineHost.value
  if (host === null || handle === null) return
  host.innerHTML = ''
  try {
    outliner = await handle.mountOutliner(host)
  } catch (err) {
    viewMode.value = 'map'
    fail(err, null)
  }
}

/** 切换导图 / 大纲视图 */
async function switchViewStage(mode: ViewMode): Promise<void> {
  if (mode === viewMode.value) return
  viewMode.value = mode
  if (mode === 'outline') {
    await nextTick()
    await createOutliner()
    return
  }
  destroyOutliner()
  await nextTick()
  refreshStats()
  handleSelect()
}

/** 节点操作（操作条入口） */
async function nodeAction(action: NodeAction): Promise<void> {
  if (handle === null) return
  try {
    if (action === 'child') await handle.addChild()
    else if (action === 'sibling') await handle.addSibling()
    else if (action === 'parent') await handle.insertParent()
    else if (action === 'up') await handle.moveUp()
    else if (action === 'down') await handle.moveDown()
    else await handle.removeSelected()
    refreshStats()
    handleSelect()
  } catch (err) {
    fail(err, null)
  }
}

/** 打开备注 / 链接编辑 */
function openNoteModal(): void {
  const node = handle?.getSelectedNode() ?? null
  if (node === null) {
    warn('请先在画布中选择一个节点')
    return
  }
  noteDraft.value = node.note
  linkDraft.value = node.hyperLink
  noteVisible.value = true
}

/** 保存备注 / 链接 */
async function saveNoteMeta(): Promise<void> {
  if (handle === null) return
  const link = linkDraft.value.trim()
  if (link !== '' && !/^(https?:\/\/|mailto:)/iu.test(link)) {
    warn('链接需以 http://、https:// 或 mailto: 开头')
    return
  }
  const applied = await handle.setNodeMeta({ note: noteDraft.value.trim(), hyperLink: link })
  if (!applied) return
  dirty.value = true
  refreshStats()
  scheduleDraft()
  syncSelection()
  noteVisible.value = false
}

/** 聚焦搜索框 */
function focusSearch(): void {
  searchWrap.value?.querySelector('input')?.focus()
}

/** 执行搜索（主题与备注） */
function runSearch(): void {
  searchResults.value = handle === null ? [] : searchNodes(handle.getData(), searchKeyword.value)
}

/** 跳转到命中节点 */
async function jumpToHit(hit: NodeSearchHit): Promise<void> {
  try {
    if (viewMode.value === 'outline') await switchViewStage('map')
    await nextTick()
    handle?.focusById(hit.id)
    searchResults.value = []
    handleSelect()
  } catch (err) {
    searchResults.value = []
    fail(err, null)
  }
}

/** 回车跳转首条命中 */
function jumpToFirstHit(): void {
  const first = searchResults.value[0]
  if (first !== undefined) void jumpToHit(first)
}

/** 打开「从文本生成」弹窗（空态默认替换，画布内默认追加） */
function openTextModal(): void {
  textDraft.value = ''
  textMode.value = handle === null ? 'replace' : 'append'
  textVisible.value = true
}

/** 用文本大纲替换当前导图 */
async function replaceWithText(text: string): Promise<void> {
  try {
    const imported = importOutlineText(text)
    direction.value = normalizeDirection(imported.data.direction)
    await mountDocument(imported.data)
    currentPath.value = ''
    currentName.value = ''
    currentMtimeMs.value = null
    dirty.value = true
    notice.value = imported.warnings
    draftPaused.value = false
    resetDraft()
    scheduleDraft()
    textVisible.value = false
  } catch (err) {
    fail(err, 'import')
  }
}

/** 把文本大纲追加到选中节点（未选中则追加到根） */
async function appendText(text: string): Promise<void> {
  if (handle === null) {
    warn('请先新建或打开一张导图')
    return
  }
  try {
    const imported = importOutlineText(text)
    if (countNodes(handle.getData()) + countNodes(imported.data) > MAX_NODES) {
      throw toolError('MM_NODE_LIMIT', 'nodes')
    }
    const target = handle.getSelectedNode()?.id
    const count = await handle.appendNodes(imported.entries, target)
    if (count === 0) {
      warn('未能追加节点，请先在画布中选择一个节点')
      return
    }
    dirty.value = true
    refreshStats()
    scheduleDraft()
    notice.value =
      imported.warnings.length === 0 ? [`已追加 ${String(count)} 个顶层节点`] : imported.warnings
    textVisible.value = false
  } catch (err) {
    fail(err, 'import')
  }
}

/** 确认「从文本生成」 */
function applyTextOutline(): void {
  const text = textDraft.value
  if (text.trim() === '') {
    warn('请先粘贴或输入大纲文本')
    return
  }
  if (textMode.value === 'replace') {
    if (dirty.value) {
      pendingText = text
      pendingAction.value = 'text-replace'
      textVisible.value = false
      confirmVisible.value = true
      return
    }
    void replaceWithText(text)
    return
  }
  void appendText(text)
}

/** 草稿调度（800ms 防抖、4000ms 最长等待） */
function scheduleDraft(): void {
  if (draftPaused.value) return
  const now = Date.now()
  if (draftDeadline === 0) draftDeadline = now + 4000
  if (draftTimer !== undefined) clearTimeout(draftTimer)
  const delay = Math.min(800, Math.max(0, draftDeadline - now))
  draftTimer = setTimeout(() => {
    void flushDraft()
  }, delay)
}

/** 立即写草稿（内容超 2MB 时暂停本次会话自动保存） */
async function flushDraft(): Promise<void> {
  if (draftTimer !== undefined) clearTimeout(draftTimer)
  draftTimer = undefined
  draftDeadline = 0
  if (handle === null || !dirty.value) return
  try {
    const data = sanitizeDocument(handle.getData()).data
    const result = await saveDraft({
      data,
      ...(currentPath.value === '' ? {} : { documentPath: currentPath.value })
    })
    draftSavedAt.value = result.savedAt
  } catch (err) {
    const structured = toStructuredError(err)
    if (structured.code === 'MM_DRAFT_TOO_LARGE') {
      draftPaused.value = true
      warn(structured.message)
    }
  }
}

/** 清除草稿（新建/打开/导入/保存成功后） */
function resetDraft(): void {
  draftInfo.value = null
  draftSavedAt.value = ''
  void clearDraft().catch(() => undefined)
}

/** 挂载文档到画布（主题 tokens 桥接） */
async function mountDocument(data: MindmapDocument): Promise<void> {
  const host = canvasHost.value
  if (host === null) throw toolError('MM_INVALID_DOCUMENT', '画布未就绪')
  const hadDocument = instanceReady.value
  destroyOutliner()
  phase.value = 'ready'
  booting.value = true
  await nextTick()
  handle?.destroy()
  handle = null
  instanceReady.value = false
  host.innerHTML = ''
  try {
    handle = await createMindElixir({
      el: host,
      data,
      theme: buildTheme(readTokens(), themeMode.value),
      direction: direction.value,
      onDirty: handleDirty,
      onDirection: handleDirection,
      onSelect: handleSelect
    })
    instanceReady.value = true
    phase.value = 'ready'
    selectionCount.value = 0
    markClean()
    if (viewMode.value === 'outline') {
      await nextTick()
      await createOutliner()
    }
  } catch (err) {
    if (!hadDocument) phase.value = 'empty'
    throw err
  } finally {
    booting.value = false
  }
}

/** 新建空白导图 */
async function createNew(): Promise<void> {
  errInfo.value = null
  direction.value = 2
  try {
    await mountDocument(createDocument(emptyTopic.value))
    currentPath.value = ''
    currentName.value = ''
    currentMtimeMs.value = null
    dirty.value = false
    notice.value = []
    draftPaused.value = false
    resetDraft()
  } catch (err) {
    fail(err, 'save')
  }
}

/** 请求动作（有未保存修改先确认） */
function requestAction(action: PendingAction): void {
  if (dirty.value) {
    pendingAction.value = action
    confirmVisible.value = true
    return
  }
  void executeAction(action)
}

/** 执行确认后的动作 */
async function executeAction(action: PendingAction): Promise<void> {
  confirmVisible.value = false
  if (action === 'new') await createNew()
  else if (action === 'open') await requestOpen()
  else if (action === 'text-replace') await replaceWithText(pendingText)
  else chooseImportFile(action === 'import-opml' ? 'opml' : 'markdown')
}

/** 打开 .json（系统对话框） */
async function requestOpen(): Promise<void> {
  try {
    const picked = await openDialog()
    if (picked === null) return
    await openPath(picked.path)
  } catch (err) {
    fail(err, 'open', () => openPath(''))
  }
}

/** 读取并载入指定路径文档 */
async function openPath(path: string): Promise<void> {
  if (path === '') return
  busy.value = '正在打开…'
  errInfo.value = null
  try {
    const result = await openDocument({ path })
    const sanitized = sanitizeDocument(result.data)
    await mountDocument(sanitized.data)
    currentPath.value = result.path
    currentName.value = result.name
    currentMtimeMs.value = result.mtimeMs
    direction.value = normalizeDirection(sanitized.data.direction)
    dirty.value = false
    notice.value = sanitized.warnings
    draftPaused.value = false
    resetDraft()
  } catch (err) {
    fail(err, 'open', () => openPath(path))
  } finally {
    busy.value = ''
  }
}

/** 隐藏 input 选择导入文件（取绝对路径） */
function chooseImportFile(kind: ImportKind): void {
  lastImportKind = kind
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = kind === 'markdown' ? '.md,.markdown' : '.opml'
  input.style.display = 'none'
  input.addEventListener(
    'change',
    () => {
      const file = input.files?.[0]
      input.remove()
      if (file === undefined) return
      const path = window.lumin.getPathForFile(file)
      if (path === '') {
        fail(toolError('MM_INVALID_PATH'), 'import')
        return
      }
      void runImport(path, kind)
    },
    { once: true }
  )
  document.body.appendChild(input)
  input.click()
}

/** 读取文本 → 纯函数导入 → 挂载 */
async function runImport(path: string, kind: ImportKind): Promise<void> {
  busy.value = kind === 'markdown' ? '正在导入 Markdown…' : '正在导入 OPML…'
  errInfo.value = null
  try {
    const result = await readTextFile({ path })
    const imported = kind === 'markdown' ? importMarkdown(result.text) : importOpml(result.text)
    await mountDocument(imported.data)
    currentPath.value = ''
    currentName.value = result.name.replace(/\.[^.]+$/u, '')
    currentMtimeMs.value = null
    direction.value = normalizeDirection(imported.data.direction)
    dirty.value = true
    notice.value = imported.warnings
    resetDraft()
    scheduleDraft()
  } catch (err) {
    fail(err, 'import', () => runImport(path, kind))
  } finally {
    busy.value = ''
  }
}

/** 默认 .json 文件名 */
function defaultJsonName(): string {
  const base = (currentName.value === '' ? '未命名导图' : currentName.value).replace(
    /\.(json|md|markdown|opml|svg|png)$/iu,
    ''
  )
  return `${base}.json`
}

/** 保存（无路径转另存为） */
async function saveDocumentFile(force = false): Promise<boolean> {
  if (handle === null) return false
  if (currentPath.value === '') return saveAs()
  return saveTo(currentPath.value, force)
}

/** 另存为 */
async function saveAs(): Promise<boolean> {
  if (handle === null) return false
  const path = await window.lumin.pickSaveFile({
    title: '保存思维导图',
    defaultName: defaultJsonName(),
    filters: [{ name: '思维导图', extensions: ['json'] }]
  })
  if (path === null) return false
  currentPath.value = ''
  currentMtimeMs.value = null
  return saveTo(path, true)
}

/** 保存到指定路径（mtime 冲突弹覆盖确认） */
async function saveTo(path: string, force: boolean): Promise<boolean> {
  if (handle === null) return false
  busy.value = '正在保存…'
  errInfo.value = null
  try {
    const data = sanitizeDocument(handle.getData()).data
    const result = await saveDocument({
      path,
      data,
      ...(currentMtimeMs.value === null ? {} : { expectedMtimeMs: currentMtimeMs.value }),
      ...(force ? { force: true } : {})
    })
    currentPath.value = result.path
    currentName.value = basenameOf(result.path)
    currentMtimeMs.value = result.mtimeMs
    dirty.value = false
    draftPaused.value = false
    notice.value = result.warnings
    resetDraft()
    return true
  } catch (err) {
    const structured = toStructuredError(err)
    if (structured.code === 'MM_FILE_CHANGED') {
      errInfo.value = structured
      errorAction.value = 'save'
      fileChangedVisible.value = true
    } else {
      fail(err, 'save', async () => {
        await saveTo(path, true)
      })
    }
    return false
  } finally {
    busy.value = ''
  }
}

/** 覆盖保存（外部修改冲突） */
async function overwriteSave(): Promise<void> {
  fileChangedVisible.value = false
  await saveTo(currentPath.value, true)
}

/** 冲突后另存 */
async function saveAsAfterConflict(): Promise<void> {
  fileChangedVisible.value = false
  await saveAs()
}

/** 导出保存路径 */
async function pickExportPath(kind: ExportKind | ImageFormat): Promise<string | null> {
  const base = (currentName.value === '' ? '未命名导图' : currentName.value).replace(
    /\.(json|md|markdown|opml|svg|png)$/iu,
    ''
  )
  const config: Record<string, { ext: string; name: string }> = {
    json: { ext: 'json', name: '思维导图 JSON' },
    markdown: { ext: 'md', name: 'Markdown 大纲' },
    opml: { ext: 'opml', name: 'OPML 大纲' },
    png: { ext: 'png', name: 'PNG 图片' },
    svg: { ext: 'svg', name: 'SVG 图片' }
  }
  const target = config[kind]
  if (target === undefined) return null
  return window.lumin.pickSaveFile({
    title: '导出思维导图',
    defaultName: `${base}.${target.ext}`,
    filters: [{ name: target.name, extensions: [target.ext] }]
  })
}

/** 导出 JSON / Markdown / OPML */
async function exportTextFile(kind: ExportKind): Promise<void> {
  if (handle === null) return
  const path = await pickExportPath(kind)
  if (path === null) return
  busy.value = '正在导出…'
  errInfo.value = null
  try {
    const raw = handle.getData()
    const text =
      kind === 'json'
        ? serializeDocument(raw, { pretty: true })
        : kind === 'markdown'
          ? exportMarkdown(raw)
          : exportOpml(raw)
    await writeExport({ path, text })
    notice.value = [`已导出 ${basenameOf(path)}`]
  } catch (err) {
    fail(err, 'export', () => exportTextFile(kind))
  } finally {
    busy.value = ''
  }
}

/** 克隆画布（重置 transform，按包围盒平移） */
function snapshotCanvas(host: HTMLElement, box: ExportBox): string {
  const canvas = host.querySelector('.map-canvas')
  if (!(canvas instanceof HTMLElement)) return ''
  const clone = canvas.cloneNode(true) as HTMLElement
  clone.style.transform = 'none'
  clone.style.position = 'absolute'
  clone.style.left = '0'
  clone.style.top = '0'
  return [
    `<div style="position:relative;width:${String(box.width)}px;height:${String(box.height)}px;overflow:hidden">`,
    `<div style="position:absolute;left:${String(-box.x)}px;top:${String(-box.y)}px">`,
    clone.outerHTML,
    '</div></div>'
  ].join('')
}

/** 分支线快照（.lines 内 path 自带 stroke 属性，平移后即为独立 SVG 片段） */
function snapshotLines(host: HTMLElement, box: ExportBox): string {
  const lines = host.querySelector('.lines')
  if (!(lines instanceof Element)) return ''
  return `<g transform="translate(${String(-box.x)} ${String(-box.y)})">${lines.outerHTML}</g>`
}

/** 收集栅格化节点（几何复用布局偏移，样式取计算值） */
function collectRasterNodes(host: HTMLElement, box: ExportBox): RasterNode[] {
  const scale = handle === null ? 1 : handle.getScalePercent() / 100
  const rects = collectStageRects(host, scale)
  const topics = Array.from(host.querySelectorAll('.me-tpc'))
  const nodes: RasterNode[] = []
  for (let index = 0; index < topics.length; index += 1) {
    const rect = rects[index]
    const element = topics[index]
    if (rect === undefined || !(element instanceof HTMLElement)) continue
    const style = getComputedStyle(element)
    const borderWidth = Number.parseFloat(style.borderTopWidth)
    const radius = Number.parseFloat(style.borderTopLeftRadius)
    const fontSize = Number.parseFloat(style.fontSize)
    nodes.push({
      x: rect.x - box.x,
      y: rect.y - box.y,
      width: rect.width,
      height: rect.height,
      text: element.innerText,
      fill: style.backgroundColor,
      color: style.color,
      stroke: style.borderTopColor,
      strokeWidth: Number.isFinite(borderWidth) ? borderWidth : 0,
      radius: Number.isFinite(radius) ? radius : 0,
      fontSize: Number.isFinite(fontSize) ? fontSize : 14,
      fontWeight: style.fontWeight
    })
  }
  return nodes
}

/** 导出图片（PNG / SVG） */
async function exportImage(): Promise<void> {
  if (handle === null) return
  const path = await pickExportPath(imageFormat.value)
  if (path === null) return
  const host = canvasHost.value
  if (host === null) {
    fail(toolError('MM_EXPORT_FAILED', '画布未就绪'), 'export')
    return
  }
  busy.value =
    imageFormat.value === 'png' ? `正在导出 PNG（${String(imageScale.value)}×）…` : '正在导出 SVG…'
  errInfo.value = null
  exportCancelVisible.value = false
  const controller = new AbortController()
  exportController = controller
  const timer = window.setTimeout(() => {
    if (busy.value !== '') exportCancelVisible.value = true
  }, 1500)

  try {
    const rects = collectStageRects(host, handle.getScalePercent() / 100)
    const box = computeExportBox(rects, 32)
    const size = resolveExportSize(box.width, box.height, imageScale.value)
    const tokens = readTokens()
    const background =
      imageBackground.value === 'theme'
        ? tokens.bg
        : imageBackground.value === 'white'
          ? '#ffffff'
          : null
    const svg = buildSvgDocument({
      width: box.width,
      height: box.height,
      scale: imageScale.value,
      background,
      css: `${mindElixirCss}\n${themeCssText(tokens)}`,
      body: snapshotCanvas(host, box)
    })
    if (imageFormat.value === 'svg') {
      await writeExport({ path, text: svg })
    } else {
      const raster = buildRasterSvg({
        width: box.width,
        height: box.height,
        scale: imageScale.value,
        background,
        lines: snapshotLines(host, box),
        nodes: collectRasterNodes(host, box)
      })
      const blob = await rasterizePng(raster, size.width, size.height, controller.signal)
      await writeExport({ path, base64: await blobToBase64(blob) })
    }
    notice.value = [`已导出 ${basenameOf(path)}`]
    imageModalVisible.value = false
  } catch (err) {
    if (exportController?.signal.aborted === true) notice.value = ['已取消导出']
    else fail(err, 'export', () => exportImage())
  } finally {
    window.clearTimeout(timer)
    exportCancelVisible.value = false
    busy.value = ''
    exportController = null
  }
}

/** 取消图片导出 */
function cancelExport(): void {
  exportController?.abort()
}

/** 切换布局方向 */
function changeDirection(value: string | number): void {
  const next = normalizeDirection(Number(value))
  direction.value = next
  handle?.setDirection(next)
}

/** 缩放（10–200，步进 10） */
function setZoom(percent: number): void {
  if (handle === null) return
  handle.setScale(percent)
  nextTick(refreshStats)
}

/** 适应窗口 */
function fitCanvas(): void {
  handle?.fit()
  nextTick(refreshStats)
}

/** 全部展开 / 折叠 */
function expandAll(expand: boolean): void {
  handle?.expandAll(expand)
}

/** 切换壳主题（写 html[data-theme]，由观察器同步画布主题） */
function toggleTheme(): void {
  document.documentElement.dataset.theme = themeMode.value === 'dark' ? 'light' : 'dark'
}

/** 重渲染画布主题（抑制 refresh 触发的脏标记） */
function applyThemeToCanvas(): void {
  if (handle === null) return
  suppressDirty = true
  try {
    handle.changeTheme(buildTheme(readTokens(), themeMode.value))
  } finally {
    queueMicrotask(() => {
      suppressDirty = false
    })
  }
}

/** 同步样式抽屉选中节点 */
function syncSelection(): void {
  const node = handle?.getSelectedNode() ?? null
  selectedNode.value = node
  if (node === null) {
    styleBackground.value = ''
    styleColor.value = ''
    styleBorderWidth.value = '0'
    styleBorderColor.value = defaultBorderColor()
    styleFontSize.value = null
    styleBold.value = false
    styleBranchColor.value = ''
    return
  }
  const style = node.style
  styleBackground.value = style.background ?? ''
  styleColor.value = style.color ?? ''
  const border = /^([12])px solid (#[0-9a-fA-F]{6})$/u.exec(style.border ?? '')
  styleBorderWidth.value = border === null ? '0' : ((border[1] ?? '1') as BorderWidth)
  styleBorderColor.value = border?.[2] ?? defaultBorderColor()
  const size = Number(style.fontSize)
  styleFontSize.value = Number.isFinite(size) && size > 0 ? size : null
  const weight = style.fontWeight ?? ''
  styleBold.value = weight === '700' || weight === 'bold'
  styleBranchColor.value = node.branchColor
}

/** 打开样式抽屉 */
function openStyleDrawer(): void {
  syncSelection()
  drawerVisible.value = true
}

/** 写回样式补丁（合并当前样式） */
async function writeStyle(patch: Record<string, string | undefined>): Promise<void> {
  if (handle === null) return
  const current = handle.getSelectedNode()
  if (current === null) return
  const style: Record<string, string> = { ...current.style }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === '') delete style[key]
    else style[key] = value
  }
  const branchColor = styleBranchColor.value.trim()
  const applied = await handle.applyNodeStyle({
    style,
    ...(branchColor === '' ? {} : { branchColor })
  })
  if (applied) {
    dirty.value = true
    scheduleDraft()
    refreshStats()
    syncSelection()
  }
}

/** 背景色 */
function onBackgroundChange(value: string | null): void {
  void writeStyle({ background: value ?? undefined })
}

/** 文字色 */
function onColorChange(value: string | null): void {
  void writeStyle({ color: value ?? undefined })
}

/** 当前边框值（无边框返回 undefined） */
function borderValue(): string | undefined {
  if (styleBorderWidth.value === '0') return undefined
  return `${styleBorderWidth.value}px solid ${styleBorderColor.value}`
}

/** 边框粗细 */
function onBorderWidthChange(value: string | number): void {
  styleBorderWidth.value = String(value) as BorderWidth
  void writeStyle({ border: borderValue() })
}

/** 边框颜色（无边框时仅记住颜色，不写入样式） */
function onBorderColorChange(value: string | null): void {
  styleBorderColor.value = value ?? defaultBorderColor()
  if (styleBorderWidth.value !== '0') void writeStyle({ border: borderValue() })
}

/** 字号 */
function onFontSizeChange(value: number | null): void {
  void writeStyle({
    fontSize: value === null || value === 0 ? undefined : String(value)
  })
}

/** 加粗 */
function onBoldChange(value: boolean): void {
  void writeStyle({ fontWeight: value ? '700' : undefined })
}

/** 分支线色 */
function onBranchColorChange(value: string | null): void {
  styleBranchColor.value = value ?? ''
  void writeStyle({})
}

/** 重置节点样式 */
async function resetStyle(): Promise<void> {
  if (handle === null) return
  const applied = await handle.resetNodeStyle()
  if (applied) {
    dirty.value = true
    scheduleDraft()
    refreshStats()
    syncSelection()
  }
}

/** 恢复草稿 */
async function recoverDraft(): Promise<void> {
  const info = draftInfo.value
  if (info === null) return
  try {
    const sanitized = sanitizeDocument(info.data)
    direction.value = normalizeDirection(sanitized.data.direction)
    await mountDocument(sanitized.data)
    currentPath.value = info.documentPath ?? ''
    currentName.value = currentPath.value === '' ? '' : basenameOf(currentPath.value)
    currentMtimeMs.value = null
    dirty.value = true
    draftSavedAt.value = info.savedAt
    draftInfo.value = null
    notice.value = sanitized.warnings
    scheduleDraft()
  } catch (err) {
    fail(err, 'draft')
  }
}

/** 丢弃草稿 */
async function discardDraft(): Promise<void> {
  draftInfo.value = null
  await clearDraft().catch(() => undefined)
}

/** 键盘快捷键（捕获阶段，Ctrl+S / Ctrl+F 等） */
function onKeydown(event: KeyboardEvent): void {
  if (phase.value !== 'ready' || handle === null) return
  const key = event.key.toLowerCase()
  const inOutline = outlineHost.value?.contains(event.target as Node) === true
  if (!event.ctrlKey && !event.metaKey) {
    if (key === '?' || (event.shiftKey && key === '/')) {
      event.preventDefault()
      helpVisible.value = true
    }
    return
  }
  if (inOutline && (key === 'z' || key === 'y')) return
  if (key === 's') {
    event.preventDefault()
    if (event.shiftKey) void saveAs()
    else void saveDocumentFile()
  } else if (key === 'o') {
    event.preventDefault()
    requestAction('open')
  } else if (key === 'n') {
    event.preventDefault()
    requestAction('new')
  } else if (key === 'f') {
    event.preventDefault()
    focusSearch()
  } else if (key === '/') {
    event.preventDefault()
    helpVisible.value = !helpVisible.value
  } else if (key === '0') {
    event.preventDefault()
    fitCanvas()
  } else if (key === '=' || key === '+') {
    event.preventDefault()
    setZoom(zoomPercent.value + 10)
  } else if (key === '-') {
    event.preventDefault()
    setZoom(zoomPercent.value - 10)
  }
}

/** 关闭/刷新前提示未保存 */
function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

/** 启动时探测草稿 */
async function probeDraft(): Promise<void> {
  try {
    const result = await loadDraft()
    if (result.status === 'ok') {
      draftInfo.value = {
        savedAt: result.savedAt,
        ...(result.documentPath === undefined ? {} : { documentPath: result.documentPath }),
        data: result.data
      }
    } else if (result.status === 'corrupt') {
      draftCorrupt.value = true
    }
  } catch {
    // 草稿读取失败不阻塞工具使用
  }
}

watch(themeMode, () => {
  applyThemeToCanvas()
  if (viewMode.value === 'outline') void createOutliner()
})

onMounted(() => {
  themeMode.value = readThemeMode()
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('beforeunload', onBeforeUnload)
  themeObserver = new MutationObserver(() => {
    themeMode.value = readThemeMode()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  })
  void probeDraft()
})

onBeforeUnmount(() => {
  if (draftTimer !== undefined) clearTimeout(draftTimer)
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('beforeunload', onBeforeUnload)
  themeObserver?.disconnect()
  themeObserver = null
  void flushDraft()
  destroyOutliner()
  handle?.destroy()
  handle = null
  instanceReady.value = false
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 p-4">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold text-[var(--lumin-color-text)]">思维导图</h1>
        <p class="text-sm text-[var(--lumin-color-text-secondary)]">
          树形大纲与自由布局，本地保存，全程离线
        </p>
      </div>
      <div class="flex items-center gap-2 text-xs text-[var(--lumin-color-text-secondary)]">
        <span data-testid="mindmap-direction">{{ directionLabel(direction) }}</span>
        <span>·</span>
        <span data-testid="mindmap-zoom">{{ zoomPercent }}%</span>
      </div>
    </header>

    <div
      class="relative z-20 flex flex-wrap items-center gap-1 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-2"
      data-testid="mindmap-toolbar"
    >
      <NButton
        size="small"
        secondary
        :disabled="toolbarDisabled && !booting"
        data-testid="mindmap-new"
        @click="requestAction('new')"
      >
        <template #icon><NIcon :component="FilePlus" /></template>
        新建
      </NButton>
      <NButton
        size="small"
        secondary
        :disabled="toolbarDisabled"
        data-testid="mindmap-open"
        @click="requestAction('open')"
      >
        <template #icon><NIcon :component="FolderOpen" /></template>
        打开
      </NButton>
      <NButton
        size="small"
        secondary
        :disabled="toolbarDisabled"
        data-testid="mindmap-save"
        @click="saveDocumentFile()"
      >
        <template #icon><NIcon :component="Save" /></template>
        保存
      </NButton>
      <NButton
        size="small"
        secondary
        :disabled="toolbarDisabled"
        data-testid="mindmap-save-as"
        @click="saveAs()"
      >
        <template #icon><NIcon :component="SaveAll" /></template>
        另存为
      </NButton>

      <span class="mx-1 h-5 w-px bg-[var(--lumin-color-border)]" />

      <NButton
        size="small"
        :secondary="viewMode !== 'map'"
        :type="viewMode === 'map' ? 'primary' : 'default'"
        :disabled="toolbarDisabled"
        data-testid="mindmap-view-map"
        @click="switchViewStage('map')"
      >
        <template #icon><NIcon :component="Network" /></template>
        导图
      </NButton>
      <NButton
        size="small"
        :secondary="viewMode !== 'outline'"
        :type="viewMode === 'outline' ? 'primary' : 'default'"
        :disabled="toolbarDisabled"
        data-testid="mindmap-view-outline"
        @click="switchViewStage('outline')"
      >
        <template #icon><NIcon :component="ListTree" /></template>
        大纲
      </NButton>

      <span class="mx-1 h-5 w-px bg-[var(--lumin-color-border)]" />

      <NButton
        size="small"
        quaternary
        :disabled="toolbarDisabled"
        data-testid="mindmap-undo"
        @click="handle?.undo()"
      >
        <template #icon><NIcon :component="Undo2" /></template>
      </NButton>
      <NButton
        size="small"
        quaternary
        :disabled="toolbarDisabled"
        data-testid="mindmap-redo"
        @click="handle?.redo()"
      >
        <template #icon><NIcon :component="Redo2" /></template>
      </NButton>
      <NButton
        size="small"
        quaternary
        :disabled="toolbarDisabled"
        data-testid="mindmap-style"
        @click="openStyleDrawer"
      >
        <template #icon><NIcon :component="Palette" /></template>
        样式
      </NButton>

      <span class="mx-1 h-5 w-px bg-[var(--lumin-color-border)]" />

      <NButton
        size="small"
        quaternary
        :disabled="toolbarDisabled"
        data-testid="mindmap-import-md"
        @click="requestAction('import-markdown')"
      >
        <template #icon><NIcon :component="FileDown" /></template>
        Markdown
      </NButton>
      <NButton
        size="small"
        quaternary
        :disabled="toolbarDisabled"
        data-testid="mindmap-import-opml"
        @click="requestAction('import-opml')"
      >
        <template #icon><NIcon :component="FileDown" /></template>
        OPML
      </NButton>
      <NButton
        size="small"
        quaternary
        :disabled="toolbarDisabled"
        data-testid="mindmap-export-json"
        @click="exportTextFile('json')"
      >
        <template #icon><NIcon :component="Download" /></template>
        JSON
      </NButton>
      <NButton
        size="small"
        quaternary
        :disabled="toolbarDisabled"
        data-testid="mindmap-export-md"
        @click="exportTextFile('markdown')"
      >
        <template #icon><NIcon :component="Download" /></template>
        MD
      </NButton>
      <NButton
        size="small"
        quaternary
        :disabled="toolbarDisabled"
        data-testid="mindmap-export-opml"
        @click="exportTextFile('opml')"
      >
        <template #icon><NIcon :component="Download" /></template>
        OPML
      </NButton>
      <NButton
        size="small"
        quaternary
        :disabled="toolbarDisabled"
        data-testid="mindmap-export-image"
        @click="imageModalVisible = true"
      >
        <template #icon><NIcon :component="ImageDown" /></template>
        图片
      </NButton>

      <span class="mx-1 h-5 w-px bg-[var(--lumin-color-border)]" />

      <NSelect
        size="small"
        style="width: 104px"
        :value="direction"
        :options="directionOptions"
        :disabled="toolbarDisabled"
        data-testid="mindmap-direction-select"
        @update:value="changeDirection"
      />
      <NButton
        size="small"
        quaternary
        :disabled="toolbarDisabled"
        data-testid="mindmap-fit"
        @click="fitCanvas"
      >
        <template #icon><NIcon :component="Maximize" /></template>
      </NButton>
      <NButton
        size="small"
        quaternary
        :disabled="toolbarDisabled"
        data-testid="mindmap-zoom-out"
        @click="setZoom(zoomPercent - 10)"
      >
        <template #icon><NIcon :component="ZoomOut" /></template>
      </NButton>
      <NButton
        size="small"
        quaternary
        :disabled="toolbarDisabled"
        data-testid="mindmap-zoom-in"
        @click="setZoom(zoomPercent + 10)"
      >
        <template #icon><NIcon :component="ZoomIn" /></template>
      </NButton>
      <NButton
        size="small"
        quaternary
        :disabled="toolbarDisabled"
        data-testid="mindmap-expand-all"
        @click="expandAll(true)"
      >
        <template #icon><NIcon :component="ChevronsUpDown" /></template>
      </NButton>
      <NButton
        size="small"
        quaternary
        :disabled="toolbarDisabled"
        data-testid="mindmap-collapse-all"
        @click="expandAll(false)"
      >
        <template #icon><NIcon :component="ChevronsDownUp" /></template>
      </NButton>

      <span class="mx-1 h-5 w-px bg-[var(--lumin-color-border)]" />

      <div ref="searchWrap" class="relative flex items-center">
        <NInput
          v-model:value="searchKeyword"
          size="small"
          clearable
          placeholder="搜索节点（Ctrl+F）"
          style="width: 176px"
          data-testid="mindmap-search"
          @input="runSearch"
          @keydown.enter.prevent="jumpToFirstHit"
          @keydown.esc="searchResults = []"
        >
          <template #prefix><NIcon :component="Search" /></template>
        </NInput>
        <div
          v-if="searchResults.length > 0"
          class="absolute left-0 top-full z-30 mt-1 max-h-64 w-72 overflow-auto rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-1 shadow-lg"
          data-testid="mindmap-search-results"
        >
          <button
            v-for="hit in searchResults"
            :key="hit.id"
            type="button"
            class="block w-full rounded px-2 py-1 text-left text-xs hover:bg-[var(--lumin-color-primary-soft)]"
            data-testid="mindmap-search-hit"
            @click="jumpToHit(hit)"
          >
            <span class="block truncate font-medium text-[var(--lumin-color-text)]">
              {{ hit.topic }}
            </span>
            <span class="block truncate text-[var(--lumin-color-text-secondary)]">
              {{ hit.matchedNote ? '备注命中 · ' : '' }}{{ hit.path }}
            </span>
          </button>
        </div>
      </div>
      <NButton
        size="small"
        quaternary
        title="粘贴文本生成导图"
        :disabled="toolbarDisabled"
        data-testid="mindmap-from-text"
        @click="openTextModal"
      >
        <template #icon><NIcon :component="FileText" /></template>
        从文本
      </NButton>
      <NButton
        size="small"
        quaternary
        title="快捷键帮助（Ctrl+/）"
        data-testid="mindmap-help"
        @click="helpVisible = true"
      >
        <template #icon><NIcon :component="Keyboard" /></template>
      </NButton>
      <NButton
        size="small"
        quaternary
        :disabled="booting"
        data-testid="mindmap-theme"
        @click="toggleTheme"
      >
        <template #icon><NIcon :component="themeMode === 'dark' ? Sun : Moon" /></template>
      </NButton>
    </div>

    <NAlert
      v-if="errInfo"
      type="error"
      closable
      data-testid="mindmap-error"
      @close="errInfo = null"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span>{{ errInfo.message }}</span>
        <span v-if="errInfo.detail" class="text-xs opacity-70">（{{ errInfo.detail }}）</span>
        <span class="text-xs opacity-70">{{ errInfo.code }}</span>
        <NButton v-if="retryAvailable" size="tiny" @click="retryLast">重试</NButton>
        <NButton
          v-if="errorAction === 'open' || errorAction === 'import'"
          size="tiny"
          @click="reselectFile"
        >
          重新选择文件
        </NButton>
      </div>
    </NAlert>

    <NAlert
      v-if="notice.length > 0"
      type="warning"
      closable
      data-testid="mindmap-notice"
      @close="notice = []"
    >
      {{ notice.join('；') }}
    </NAlert>

    <div
      class="relative min-h-0 flex-1 overflow-hidden rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-bg)]"
      data-testid="mindmap-stage"
    >
      <div v-show="phase === 'ready' && viewMode === 'map'" ref="canvasHost" class="h-full w-full" />
      <div
        v-show="phase === 'ready' && viewMode === 'outline'"
        ref="outlineHost"
        class="h-full w-full overflow-auto"
        :class="{ dark: themeMode === 'dark' }"
        data-testid="mindmap-outline"
      />

      <div
        v-if="phase === 'ready' && instanceReady && viewMode === 'map' && selectionCount > 0"
        class="absolute left-3 top-3 z-20 flex items-center gap-0.5 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)]/95 p-1 shadow-sm"
        data-testid="mindmap-node-bar"
      >
        <NButton
          quaternary
          size="tiny"
          title="新增子节点（Tab）"
          data-testid="mindmap-node-child"
          @click="nodeAction('child')"
        >
          <template #icon><NIcon :component="Plus" /></template>
        </NButton>
        <NButton
          quaternary
          size="tiny"
          title="新增同级节点（Enter）"
          data-testid="mindmap-node-sibling"
          @click="nodeAction('sibling')"
        >
          <template #icon><NIcon :component="ListPlus" /></template>
        </NButton>
        <NButton
          quaternary
          size="tiny"
          title="插入父级节点"
          data-testid="mindmap-node-parent"
          @click="nodeAction('parent')"
        >
          <template #icon><NIcon :component="CornerUpLeft" /></template>
        </NButton>
        <NButton
          quaternary
          size="tiny"
          title="上移"
          data-testid="mindmap-node-up"
          @click="nodeAction('up')"
        >
          <template #icon><NIcon :component="ArrowUp" /></template>
        </NButton>
        <NButton
          quaternary
          size="tiny"
          title="下移"
          data-testid="mindmap-node-down"
          @click="nodeAction('down')"
        >
          <template #icon><NIcon :component="ArrowDown" /></template>
        </NButton>
        <NButton
          quaternary
          size="tiny"
          title="备注 / 链接"
          data-testid="mindmap-node-note"
          @click="openNoteModal"
        >
          <template #icon><NIcon :component="MessageSquare" /></template>
        </NButton>
        <NButton
          quaternary
          size="tiny"
          title="删除节点（Delete）"
          data-testid="mindmap-node-remove"
          @click="nodeAction('remove')"
        >
          <template #icon><NIcon :component="Trash" /></template>
        </NButton>
        <span v-if="selectionCount > 1" class="px-1 text-xs text-[var(--lumin-color-text-secondary)]">
          已选 {{ selectionCount }}
        </span>
      </div>

      <div
        v-if="phase === 'empty'"
        class="absolute inset-0 z-10 flex items-center justify-center bg-[var(--lumin-color-bg)] p-6"
      >
        <div
          class="w-full max-w-md space-y-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-5"
        >
          <h2 class="text-base font-medium text-[var(--lumin-color-text)]">开始一张思维导图</h2>
          <p class="text-xs text-[var(--lumin-color-text-secondary)]">
            输入中心主题后新建，或打开本地 .json / 导入大纲文件。
          </p>
          <NInput
            v-model:value="emptyTopic"
            maxlength="200"
            placeholder="中心主题"
            data-testid="mindmap-topic-input"
            @keyup.enter="createNew"
          />
          <NButton
            type="primary"
            block
            :loading="booting"
            data-testid="mindmap-create"
            @click="createNew"
          >
            <template #icon><NIcon :component="Network" /></template>
            新建导图
          </NButton>
          <div class="grid grid-cols-2 gap-2">
            <NButton secondary data-testid="mindmap-open-empty" @click="requestAction('open')">
              <template #icon><NIcon :component="FolderOpen" /></template>
              打开文件
            </NButton>
            <NButton secondary @click="requestAction('import-markdown')">
              <template #icon><NIcon :component="FileDown" /></template>
              导入 Markdown
            </NButton>
            <NButton secondary data-testid="mindmap-text-empty" @click="openTextModal">
              <template #icon><NIcon :component="FileText" /></template>
              粘贴文本生成
            </NButton>
            <NButton secondary @click="requestAction('import-opml')">
              <template #icon><NIcon :component="FileDown" /></template>
              导入 OPML
            </NButton>
          </div>
          <NAlert
            v-if="draftInfo !== null"
            type="info"
            data-testid="mindmap-draft-alert"
            title="检测到未完成的草稿"
          >
            <div class="space-y-2">
              <p class="text-xs">保存于 {{ formatRelative(draftInfo.savedAt) }}</p>
              <div class="flex gap-2">
                <NButton
                  size="tiny"
                  type="primary"
                  data-testid="mindmap-draft-recover"
                  @click="recoverDraft"
                >
                  恢复
                </NButton>
                <NButton size="tiny" data-testid="mindmap-draft-discard" @click="discardDraft">
                  丢弃
                </NButton>
              </div>
            </div>
          </NAlert>
          <NAlert v-if="draftCorrupt" type="warning" data-testid="mindmap-draft-corrupt">
            草稿已损坏，已忽略（原文保留为 draft.corrupt-*.json）
          </NAlert>
        </div>
      </div>

      <div
        v-if="busy !== '' || booting"
        class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[var(--lumin-color-bg)]/80 backdrop-blur-sm"
        data-testid="mindmap-loading"
      >
        <NSpin size="large" />
        <p class="text-sm text-[var(--lumin-color-text)]">{{ busy || '正在准备画布…' }}</p>
        <NButton
          v-if="exportCancelVisible"
          size="small"
          data-testid="mindmap-export-cancel"
          @click="cancelExport"
        >
          取消导出
        </NButton>
      </div>
    </div>

    <footer
      class="flex flex-wrap items-center gap-3 text-xs text-[var(--lumin-color-text-secondary)]"
      data-testid="mindmap-status"
    >
      <span>{{ currentName === '' ? '未命名导图' : currentName }}</span>
      <span v-if="dirty" class="font-medium text-[var(--lumin-color-warning)]">未保存</span>
      <span data-testid="mindmap-node-count">节点 {{ nodeCount }} / {{ MAX_NODES }}</span>
      <span>布局 {{ directionLabel(direction) }}</span>
      <span v-if="draftPaused" class="text-[var(--lumin-color-warning)]">自动保存已暂停</span>
      <span v-else-if="draftSavedAt !== ''">草稿已保存 {{ formatRelative(draftSavedAt) }}</span>
    </footer>

    <NDrawer v-model:show="drawerVisible" :width="320" placement="right">
      <NDrawerContent title="节点样式" closable>
        <div v-if="selectedNode === null" class="text-sm text-[var(--lumin-color-text-secondary)]">
          请先在画布中选择一个节点。
        </div>
        <div v-else class="space-y-4">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm">背景</span>
            <NColorPicker
              :value="styleBackground"
              :modes="['hex', 'rgb']"
              :show-alpha="false"
              size="small"
              @update:value="onBackgroundChange"
            />
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm">文字颜色</span>
            <NColorPicker
              :value="styleColor"
              :modes="['hex', 'rgb']"
              :show-alpha="false"
              size="small"
              @update:value="onColorChange"
            />
          </div>
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm">边框</span>
              <NSelect
                :value="styleBorderWidth"
                :options="borderWidthOptions"
                size="small"
                style="width: 120px"
                data-testid="mindmap-style-border-width"
                @update:value="onBorderWidthChange"
              />
            </div>
            <div
              v-if="styleBorderWidth !== '0'"
              class="flex items-center justify-between gap-2"
            >
              <span class="text-xs text-[var(--lumin-color-text-secondary)]">边框颜色</span>
              <NColorPicker
                :value="styleBorderColor"
                :modes="['hex', 'rgb']"
                :show-alpha="false"
                size="small"
                @update:value="onBorderColorChange"
              />
            </div>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm">字号</span>
            <NSelect
              :value="styleFontSize ?? 0"
              :options="fontSizeOptions"
              size="small"
              style="width: 120px"
              data-testid="mindmap-style-font-size"
              @update:value="onFontSizeChange"
            />
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm">加粗</span>
            <NSwitch :value="styleBold" size="small" @update:value="onBoldChange" />
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm">分支线色</span>
            <NColorPicker
              :value="styleBranchColor"
              :modes="['hex', 'rgb']"
              :show-alpha="false"
              size="small"
              @update:value="onBranchColorChange"
            />
          </div>
          <NButton secondary block size="small" @click="resetStyle">
            <template #icon><NIcon :component="RotateCcw" /></template>
            重置节点样式
          </NButton>
        </div>
      </NDrawerContent>
    </NDrawer>

    <NModal
      v-model:show="confirmVisible"
      preset="card"
      title="有未保存的修改"
      style="width: 420px"
      data-testid="mindmap-confirm-new"
    >
      <p class="text-sm">当前导图有未保存修改，继续将放弃这些修改（自动草稿仍会保留最近内容）。</p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="confirmVisible = false">取消</NButton>
          <NButton size="small" type="primary" @click="executeAction(pendingAction)">
            放弃并继续
          </NButton>
        </div>
      </template>
    </NModal>

    <NModal
      v-model:show="fileChangedVisible"
      preset="card"
      title="文件已被外部修改"
      style="width: 460px"
    >
      <p class="text-sm">{{ errorMessage(errInfo?.code ?? '') || '文件修改时间已变化。' }}</p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="fileChangedVisible = false">取消</NButton>
          <NButton size="small" @click="saveAsAfterConflict">另存为</NButton>
          <NButton size="small" type="primary" @click="overwriteSave">覆盖保存</NButton>
        </div>
      </template>
    </NModal>

    <NModal
      v-model:show="imageModalVisible"
      preset="card"
      title="导出图片"
      style="width: 420px"
      data-testid="mindmap-image-modal"
    >
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm">格式</span>
          <NSelect
            v-model:value="imageFormat"
            size="small"
            style="width: 160px"
            :options="imageFormatOptions"
          />
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm">倍率</span>
          <NSelect
            v-model:value="imageScale"
            size="small"
            style="width: 160px"
            :options="imageScaleOptions"
          />
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm">背景</span>
          <NSelect
            v-model:value="imageBackground"
            size="small"
            style="width: 160px"
            :options="imageBackgroundOptions"
          />
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="imageModalVisible = false">取消</NButton>
          <NButton
            size="small"
            type="primary"
            data-testid="mindmap-image-confirm"
            @click="exportImage"
          >
            导出
          </NButton>
        </div>
      </template>
    </NModal>

    <NModal
      v-model:show="textVisible"
      preset="card"
      title="从文本生成导图"
      style="width: 560px"
      data-testid="mindmap-text-modal"
    >
      <div class="space-y-3">
        <p class="text-xs text-[var(--lumin-color-text-secondary)]">
          支持 Markdown 标题与列表，也支持纯文本缩进大纲（每 2 个空格或 1 个 Tab 为一级）。
        </p>
        <NInput
          v-model:value="textDraft"
          type="textarea"
          :autosize="{ minRows: 8, maxRows: 16 }"
          placeholder="# 产品规划&#10;## 需求&#10;- 用户调研&#10;- 竞品分析&#10;## 排期&#10;- 第一版"
          data-testid="mindmap-text-input"
        />
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm">处理方式</span>
          <NSelect
            v-model:value="textMode"
            size="small"
            style="width: 200px"
            :options="textModeOptions"
          />
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="textVisible = false">取消</NButton>
          <NButton size="small" type="primary" data-testid="mindmap-text-confirm" @click="applyTextOutline">
            生成
          </NButton>
        </div>
      </template>
    </NModal>

    <NModal
      v-model:show="noteVisible"
      preset="card"
      title="节点备注 / 链接"
      style="width: 480px"
      data-testid="mindmap-note-modal"
    >
      <div class="space-y-3">
        <div class="space-y-1">
          <span class="text-sm">备注</span>
          <NInput
            v-model:value="noteDraft"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 8 }"
            placeholder="补充说明（可留空）"
            data-testid="mindmap-note-input"
          />
        </div>
        <div class="space-y-1">
          <span class="text-sm">链接</span>
          <NInput
            v-model:value="linkDraft"
            placeholder="https:// 或 mailto:（可留空）"
            data-testid="mindmap-link-input"
          />
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="noteVisible = false">取消</NButton>
          <NButton size="small" type="primary" data-testid="mindmap-note-confirm" @click="saveNoteMeta">
            保存
          </NButton>
        </div>
      </template>
    </NModal>

    <NModal
      v-model:show="helpVisible"
      preset="card"
      title="快捷键"
      style="width: 520px"
      data-testid="mindmap-help-modal"
    >
      <div class="space-y-4">
        <div v-for="group in shortcutGroups" :key="group.title" class="space-y-1">
          <h3 class="text-sm font-medium text-[var(--lumin-color-text)]">{{ group.title }}</h3>
          <div
            v-for="item in group.items"
            :key="item.keys"
            class="flex items-center justify-between gap-3 text-xs"
          >
            <span class="text-[var(--lumin-color-text-secondary)]">{{ item.desc }}</span>
            <code
              class="rounded bg-[var(--lumin-color-bg-elevated)] px-1.5 py-0.5 text-[var(--lumin-color-text)]"
            >
              {{ item.keys }}
            </code>
          </div>
        </div>
        <p class="text-xs text-[var(--lumin-color-text-secondary)]">
          大纲视图内 Tab / Shift+Tab 可缩进与减少缩进，Enter 新建同级，Ctrl+Z 与导图共享同一撤销栈。
        </p>
      </div>
    </NModal>
  </div>
</template>
