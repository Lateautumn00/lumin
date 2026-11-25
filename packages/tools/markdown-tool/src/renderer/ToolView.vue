<script setup lang="ts">
/**
 * @file markdown-tool 渲染层（Markdown 预览 / JSON→TS / YAML 三页签）
 * @author cuilanchao
 * @date 2026-11-24
 * @description spec §2：解析全在 renderer 同步完成；预览用 sandbox iframe + CSP；
 *              导出经主进程 save 通道；Markdown 编辑区用 CodeMirror，支持打开已有 .md、覆盖保存与另存为。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import {
  NButton,
  NInput,
  NModal,
  NRadioButton,
  NRadioGroup,
  NTabPane,
  NTabs,
  NText
} from 'naive-ui'
import {
  Bold,
  Code,
  Copy,
  Download,
  FolderOpen,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Save,
  Search,
  SquareCode,
  Strikethrough,
  Table,
  Undo2
} from '@lucide/vue'
import type { StructuredError } from '@lumin/shared'
import { createEditor, type CursorPosition, type EditorHandle } from '@lumin/ui/create-editor'
import { buildHtmlDocument, renderMarkdown, type MarkdownOutcome } from '../markdown'
import { applyFormat, type MarkdownFormatCommand } from '../editor-format'
import { generateTypes, type DeclarationStyle } from '../json-to-ts'
import { formatYaml, jsonToYaml, yamlToJson } from '../yaml'
import { sanitizeBaseName } from '../save'
import { errorMessage, toolError, type MarkdownToolErrorCode, type ToolFailure } from '../errors'
import {
  config,
  openMarkdownFile,
  revealPath,
  saveFile,
  saveMarkdownFile,
  saveOutputDir
} from './client'

type TabKey = 'markdown' | 'json' | 'yaml'
type YamlMode = 'yaml-to-json' | 'json-to-yaml' | 'format-yaml'

/** 工具栏命令（格式化 + 撤销/重做） */
type ToolbarCommand = MarkdownFormatCommand | 'undo' | 'redo'

/** 工具栏按钮 */
interface ToolbarItem {
  command: ToolbarCommand
  icon: Component
  title: string
}

/** 工具栏分组（组间显示分隔线） */
const TOOLBAR_GROUPS: ToolbarItem[][] = [
  [
    { command: 'bold', icon: Bold, title: '粗体' },
    { command: 'italic', icon: Italic, title: '斜体' },
    { command: 'strikethrough', icon: Strikethrough, title: '删除线' },
    { command: 'inline-code', icon: Code, title: '行内代码' }
  ],
  [
    { command: 'heading', icon: Heading2, title: '标题' },
    { command: 'quote', icon: Quote, title: '引用' },
    { command: 'code-block', icon: SquareCode, title: '代码块' }
  ],
  [
    { command: 'unordered-list', icon: List, title: '无序列表' },
    { command: 'ordered-list', icon: ListOrdered, title: '有序列表' },
    { command: 'task-list', icon: ListChecks, title: '任务列表' }
  ],
  [
    { command: 'link', icon: Link, title: '链接' },
    { command: 'image', icon: ImageIcon, title: '图片' },
    { command: 'table', icon: Table, title: '表格' },
    { command: 'hr', icon: Minus, title: '分隔线' }
  ],
  [
    { command: 'undo', icon: Undo2, title: '撤销' },
    { command: 'redo', icon: Redo2, title: '重做' }
  ]
]

/** 内置示例（标题/列表/引用/表格/代码块/链接） */
const MARKDOWN_SAMPLE = [
  '# Lumin Markdown 示例',
  '',
  '## 列表与行内样式',
  '',
  '- 支持 **粗体**、*斜体* 与 `行内代码`',
  '- [链接](https://example.com)',
  '',
  '> 引用块：内容在本地渲染，脚本不会执行。',
  '',
  '| 功能 | 状态 |',
  '| --- | --- |',
  '| 预览 | 已支持 |',
  '| 导出 | 已支持 |',
  '',
  '```ts',
  "const message = 'Hello Lumin'",
  '```'
].join('\n')

const YAML_PLACEHOLDERS: Record<YamlMode, string> = {
  'yaml-to-json': '粘贴 YAML，例如：\nname: lumin\nversion: 0.1.0',
  'json-to-yaml': '粘贴 JSON，例如：{"name":"lumin","version":"0.1.0"}',
  'format-yaml': '粘贴 YAML 进行格式化（移除注释）'
}

const activeTab = ref<TabKey>('markdown')
const outputDir = ref('')
const exporting = ref(false)
const actionError = ref<StructuredError | null>(null)
const notice = ref('')
const lastOutput = ref<string | null>(null)
const copiedKey = ref('')

// —— Markdown 页签 ——
/** CodeMirror 挂载容器 */
const editorHost = ref<HTMLDivElement | null>(null)
/** 编辑器实例（异步动态加载） */
let editor: EditorHandle | null = null
/** 编辑器是否就绪（工具栏禁用态依赖，需响应式） */
const editorReady = ref(false)
/** 光标位置（状态栏展示，1 基） */
const mdCursor = ref<CursorPosition>({ line: 1, column: 1 })
/** 正文镜像（渲染与统计来源；编辑器未就绪时兜底） */
const mdInput = ref('')
const mdResult = ref<MarkdownOutcome>({ ok: true, value: { html: '', chars: 0, lines: 0 } })
const mdFileName = ref('document')
/** 当前打开/保存的磁盘路径（空 = 未命名，保存走另存为） */
const mdFilePath = ref('')
/** 磁盘文件 mtime（覆盖保存时用于冲突检测） */
const mdMtimeMs = ref<number | null>(null)
const mdDirty = ref(false)
const mdOpening = ref(false)
const mdSaving = ref(false)
const confirmOpenVisible = ref(false)
const overwriteVisible = ref(false)
let mdTimer: ReturnType<typeof setTimeout> | undefined

/** 150ms 防抖：读取编辑器正文 → 渲染预览与统计 */
function scheduleRender(): void {
  if (mdTimer !== undefined) clearTimeout(mdTimer)
  mdTimer = setTimeout(() => {
    const text = editor?.getContent() ?? mdInput.value
    mdInput.value = text
    mdResult.value = renderMarkdown(text)
  }, 150)
}

const mdHtml = computed(() => (mdResult.value.ok ? mdResult.value.value.html : ''))
const mdPreviewDoc = computed(() => buildHtmlDocument(mdHtml.value, 'Markdown 预览', 'preview'))
const mdFailure = computed<ToolFailure | null>(() => (mdResult.value.ok ? null : mdResult.value))
const mdChars = computed(() => (mdResult.value.ok ? mdResult.value.value.chars : 0))
const mdLines = computed(() => (mdResult.value.ok ? mdResult.value.value.lines : 0))
/** 状态栏文件名（未打开文件时回退「未命名」） */
const mdFileNameLabel = computed(() =>
  mdFilePath.value === '' ? '未命名' : baseNameOf(mdFilePath.value)
)

// —— JSON→TS 页签 ——
const jsonInput = ref('')
const rootName = ref('Root')
const tsStyle = ref<DeclarationStyle>('interface')
const tsFileName = ref('types')
const tsOutcome = computed(() =>
  generateTypes(jsonInput.value, { rootName: rootName.value, style: tsStyle.value })
)
const tsCode = computed(() => (tsOutcome.value.ok ? tsOutcome.value.value.code : ''))
const tsExtension = computed<'ts' | 'json'>(() => (tsStyle.value === 'json-schema' ? 'json' : 'ts'))
watch(tsStyle, (style) => {
  if (style === 'json-schema' && tsFileName.value === 'types') tsFileName.value = 'schema'
  if (style !== 'json-schema' && tsFileName.value === 'schema') tsFileName.value = 'types'
  actionError.value = null
})
const tsFailure = computed<ToolFailure | null>(() => {
  if (tsOutcome.value.ok) return null
  if (jsonInput.value.trim() === '' && rootName.value === '') return null
  return tsOutcome.value
})

// —— YAML 页签 ——
const yamlMode = ref<YamlMode>('yaml-to-json')
const yamlInput = ref('')
const yamlFileName = ref('data')
const yamlOutcome = computed(() => {
  if (yamlMode.value === 'yaml-to-json') return yamlToJson(yamlInput.value)
  if (yamlMode.value === 'json-to-yaml') return jsonToYaml(yamlInput.value)
  return formatYaml(yamlInput.value)
})
const yamlOutput = computed(() => (yamlOutcome.value.ok ? yamlOutcome.value.value.text : ''))
const yamlFailure = computed<ToolFailure | null>(() =>
  yamlOutcome.value.ok ? null : yamlOutcome.value
)
const yamlExtension = computed<'json' | 'yaml'>(() =>
  yamlMode.value === 'yaml-to-json' ? 'json' : 'yaml'
)

watch(yamlMode, () => {
  actionError.value = null
})

onMounted(async () => {
  window.addEventListener('keydown', onWindowKeydown)
  await mountEditor('')
  void loadConfig()
})

/** 读取输出目录记忆（失败时保持空，导出由主进程回退默认目录） */
async function loadConfig(): Promise<void> {
  try {
    const result = await config()
    outputDir.value = result.outputDir
  } catch {
    outputDir.value = ''
  }
}

/**
 * 错误归一化（bridge 抛错 → 结构化展示）
 * @param err 捕获异常
 * @param fallback 兜底错误码
 */
function normalizeError(err: unknown, fallback: MarkdownToolErrorCode): StructuredError {
  if (typeof err === 'object' && err !== null) {
    const source = err as { code?: unknown; message?: unknown; detail?: unknown }
    const result: StructuredError = {
      code: typeof source.code === 'string' ? source.code : fallback,
      message:
        typeof source.message === 'string' && source.message !== ''
          ? source.message
          : errorMessage(fallback)
    }
    if (typeof source.detail === 'string') result.detail = source.detail
    return result
  }
  return { code: fallback, message: errorMessage(fallback) }
}

/**
 * 失败文案（含 detail）
 * @param failure 纯函数失败结果
 */
function failureText(failure: ToolFailure): string {
  return failure.detail === undefined || failure.detail === ''
    ? failure.message
    : `${failure.message}（${failure.detail}）`
}

/**
 * 复制文本到剪贴板
 * @param key 复制成功的标记键
 * @param text 待复制文本
 */
async function copyText(key: string, text: string): Promise<void> {
  if (text === '') return
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = ''
    }, 1500)
  } catch {
    actionError.value = toolError('MD_CLIPBOARD_FAILED')
  }
}

/** 选择输出目录并记忆 */
async function chooseDirectory(): Promise<void> {
  try {
    const dir = await window.lumin.pickDirectory('选择输出目录')
    if (dir === null || dir === '') return
    outputDir.value = dir
    await saveOutputDir(dir)
  } catch (err) {
    actionError.value = normalizeError(err, 'MD_SAVE_FAILED')
  }
}

/**
 * 导出文本产物
 * @param extension 扩展名
 * @param baseName 文件名主名
 * @param content 文件内容
 */
async function exportFile(
  extension: 'html' | 'ts' | 'json' | 'yaml',
  baseName: string,
  content: string
): Promise<void> {
  if (content.trim() === '') return
  actionError.value = null
  notice.value = ''
  exporting.value = true
  try {
    const result = await saveFile({
      outputDir: outputDir.value,
      baseName: sanitizeBaseName(baseName),
      extension,
      content
    })
    lastOutput.value = result.output
    notice.value = `已导出：${result.output}`
  } catch (err) {
    actionError.value = normalizeError(err, 'MD_SAVE_FAILED')
  } finally {
    exporting.value = false
  }
}

/** 打开最近一次导出所在文件夹 */
function openFolder(): void {
  if (lastOutput.value === null) return
  void revealPath(lastOutput.value).catch(() => undefined)
}

/** 文件名去 Markdown 扩展名（导出 HTML 默认名） */
function stripMdExtension(name: string): string {
  const stripped = name.replace(/\.(md|markdown|txt)$/i, '')
  return stripped === '' ? 'document' : stripped
}

/** 路径取文件名 */
function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/**
 * 挂载 CodeMirror（动态 import；R5 取舍见 @lumin/ui/create-editor 注释）
 * @param content 初始正文
 */
async function mountEditor(content: string): Promise<void> {
  editor?.destroy()
  editor = null
  editorReady.value = false
  await nextTick()
  const host = editorHost.value
  if (host === null) return
  host.innerHTML = ''
  mdInput.value = content
  mdResult.value = renderMarkdown(content)
  mdCursor.value = { line: 1, column: 1 }
  try {
    editor = await createEditor({
      container: host,
      content,
      language: 'markdown',
      onChange: () => {
        mdDirty.value = true
        scheduleRender()
      },
      onCursor: (position) => {
        mdCursor.value = position
      }
    })
    editorReady.value = true
  } catch (err) {
    actionError.value = normalizeError(err, 'MD_EDITOR_FAILED')
    return
  }
  // 动态加载期间用户可能已载入示例/清空 → 以最新镜像为准
  if (mdInput.value !== content) editor.setContent(mdInput.value)
}

/**
 * 执行工具栏命令（撤销/重做走编辑器命令，其余走格式化纯函数）
 * @param command 工具栏命令
 */
function runToolbar(command: ToolbarCommand): void {
  if (editor === null) return
  if (command === 'undo') {
    editor.undo()
    return
  }
  if (command === 'redo') {
    editor.redo()
    return
  }
  const selection = editor.getSelection()
  const change = applyFormat(editor.getContent(), selection.from, selection.to, command)
  editor.replaceRange(change.from, change.to, change.insert, {
    from: change.selectionFrom,
    to: change.selectionTo
  })
}

/** 工具栏「打开 .md」：有未保存更改先确认 */
function openDocument(): void {
  if (mdDirty.value) {
    confirmOpenVisible.value = true
    return
  }
  void doOpenDocument()
}

/** 执行打开：系统对话框选择 → 主进程读取 → 重建编辑器 */
async function doOpenDocument(): Promise<void> {
  mdOpening.value = true
  actionError.value = null
  notice.value = ''
  try {
    const result = await openMarkdownFile()
    if (result === null) return
    mdFilePath.value = result.path
    mdMtimeMs.value = result.mtimeMs
    mdFileName.value = stripMdExtension(result.name)
    mdDirty.value = false
    await mountEditor(result.content)
    notice.value = `已打开：${result.path}`
  } catch (err) {
    actionError.value = normalizeError(err, 'MD_READ_FAILED')
  } finally {
    mdOpening.value = false
  }
}

/** 确认放弃未保存更改并打开 */
function confirmOpen(): void {
  confirmOpenVisible.value = false
  mdDirty.value = false
  void doOpenDocument()
}

/**
 * 保存到已打开路径（未命名则走另存为）
 * @param force 忽略 mtime 冲突（确认覆盖后强制保存）
 * @returns 是否保存成功
 */
async function saveDocument(force = false): Promise<boolean> {
  if (mdFilePath.value === '') return saveDocumentAs()
  if (mdSaving.value) return false
  mdSaving.value = true
  actionError.value = null
  try {
    const content = editor?.getContent() ?? mdInput.value
    const result = await saveMarkdownFile({
      path: mdFilePath.value,
      content,
      ...(mdMtimeMs.value === null ? {} : { expectedMtimeMs: mdMtimeMs.value }),
      ...(force ? { force: true } : {})
    })
    mdMtimeMs.value = result.mtimeMs
    mdDirty.value = false
    notice.value = `已保存：${result.path}`
    return true
  } catch (err) {
    const structured = normalizeError(err, 'MD_SAVE_FAILED')
    if (structured.code === 'MD_FILE_CHANGED') {
      overwriteVisible.value = true
      return false
    }
    actionError.value = structured
    return false
  } finally {
    mdSaving.value = false
  }
}

/** 另存为：系统保存对话框选路径后原子落盘 */
async function saveDocumentAs(): Promise<boolean> {
  actionError.value = null
  notice.value = ''
  let target: string | null
  try {
    target = await window.lumin.pickSaveFile({
      title: '另存为 Markdown',
      defaultName: `${sanitizeBaseName(mdFileName.value)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
  } catch (err) {
    actionError.value = normalizeError(err, 'MD_SAVE_FAILED')
    return false
  }
  if (target === null || target === '') return false
  if (mdSaving.value) return false
  mdSaving.value = true
  try {
    const content = editor?.getContent() ?? mdInput.value
    const result = await saveMarkdownFile({ path: target, content })
    mdFilePath.value = target
    mdMtimeMs.value = result.mtimeMs
    mdFileName.value = stripMdExtension(baseNameOf(target))
    mdDirty.value = false
    notice.value = `已保存：${result.path}`
    return true
  } catch (err) {
    actionError.value = normalizeError(err, 'MD_SAVE_FAILED')
    return false
  } finally {
    mdSaving.value = false
  }
}

/** 确认覆盖（磁盘文件已被外部修改） */
function confirmOverwrite(): void {
  overwriteVisible.value = false
  void saveDocument(true)
}

/** 工具栏「查找」→ CodeMirror 查找面板 */
function openSearch(): void {
  editor?.openSearch()
}

/**
 * 程序化写入正文（setContent 不触发 onChange，需手动同步渲染）
 * @param text 新正文
 */
function applyContent(text: string): void {
  const current = editor?.getContent() ?? mdInput.value
  if (current === text) return
  editor?.setContent(text)
  // 仅在已关联磁盘文件时标记未保存（示例/清空属于模板内容，不产生关闭拦截）
  if (mdFilePath.value !== '') mdDirty.value = true
  mdInput.value = text
  mdResult.value = renderMarkdown(text)
  editor?.focus()
}

/** 载入示例 Markdown */
function loadSample(): void {
  applyContent(MARKDOWN_SAMPLE)
}

/** 清空正文 */
function clearMarkdown(): void {
  applyContent('')
}

/** Ctrl+S：保存 Markdown 文档（仅 Markdown 页签） */
function onWindowKeydown(event: KeyboardEvent): void {
  if (activeTab.value !== 'markdown') return
  if (!(event.ctrlKey || event.metaKey)) return
  if (event.key.toLowerCase() !== 's') return
  event.preventDefault()
  void saveDocument()
}

/** 有未保存更改时拦截窗口关闭 */
function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!mdDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

watch(mdDirty, (value) => {
  if (value) window.addEventListener('beforeunload', onBeforeUnload)
  else window.removeEventListener('beforeunload', onBeforeUnload)
})

onBeforeUnmount(() => {
  if (mdTimer !== undefined) clearTimeout(mdTimer)
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  editor?.destroy()
  editor = null
})
</script>

<template>
  <div class="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-base font-semibold">Markdown 工具</h1>
      <div class="flex min-w-0 items-center gap-2 text-xs text-[var(--lumin-color-text-secondary)]">
        <FolderOpen class="h-3 w-3 shrink-0" aria-hidden="true" />
        <span
          class="max-w-56 truncate"
          :title="outputDir === '' ? '默认输出目录：userData/markdown' : outputDir"
          data-testid="output-dir"
        >
          {{ outputDir === '' ? '默认输出目录' : outputDir }}
        </span>
        <NButton size="tiny" quaternary data-testid="choose-dir" @click="chooseDirectory">
          选择
        </NButton>
        <NButton v-if="lastOutput !== null" size="tiny" quaternary @click="openFolder">
          打开文件夹
        </NButton>
      </div>
    </header>

    <div
      v-if="actionError !== null"
      role="alert"
      class="text-sm text-[var(--lumin-color-error)]"
      data-testid="action-error"
    >
      {{ actionError.code }} · {{ actionError.message }}
      <span v-if="actionError.detail" class="text-xs">（{{ actionError.detail }}）</span>
    </div>
    <NText v-if="notice !== ''" depth="2" class="text-xs" data-testid="export-notice">
      {{ notice }}
    </NText>

    <NTabs
      v-model:value="activeTab"
      type="line"
      animated
      display-directive="show"
      class="flex min-h-0 flex-1 flex-col"
      pane-wrapper-class="min-h-0 flex-1"
      pane-class="h-full overflow-auto"
    >
      <!-- Markdown 预览 -->
      <NTabPane name="markdown" tab="Markdown">
        <div class="flex h-full min-h-0 flex-col gap-3 pt-2">
          <div class="flex flex-wrap items-center gap-2">
            <NButton
              size="tiny"
              secondary
              :loading="mdOpening"
              data-testid="md-open"
              @click="openDocument"
            >
              <FolderOpen class="mr-1 h-3 w-3" />打开 .md
            </NButton>
            <NButton
              size="tiny"
              secondary
              :loading="mdSaving"
              data-testid="md-save"
              @click="saveDocument()"
            >
              <Save class="mr-1 h-3 w-3" />保存
            </NButton>
            <NButton
              size="tiny"
              quaternary
              :loading="mdSaving"
              data-testid="md-save-as"
              @click="saveDocumentAs"
            >
              另存为
            </NButton>
            <NButton size="tiny" quaternary data-testid="md-search" @click="openSearch">
              <Search class="mr-1 h-3 w-3" />查找
            </NButton>
            <NButton
              size="tiny"
              quaternary
              :disabled="mdHtml === ''"
              data-testid="copy-html"
              @click="copyText('md', mdHtml)"
            >
              <Copy class="mr-1 h-3 w-3" />{{ copiedKey === 'md' ? '已复制' : '复制 HTML' }}
            </NButton>
            <span
              class="mx-1 h-4 w-px bg-[var(--lumin-color-border, #e0e0e6)]"
              aria-hidden="true"
            ></span>
            <NButton size="tiny" quaternary data-testid="load-sample" @click="loadSample">
              载入示例
            </NButton>
            <NButton size="tiny" quaternary data-testid="clear-markdown" @click="clearMarkdown">
              清空
            </NButton>
            <span
              class="mx-1 h-4 w-px bg-[var(--lumin-color-border, #e0e0e6)]"
              aria-hidden="true"
            ></span>
            <NInput
              v-model:value="mdFileName"
              size="tiny"
              style="width: 9rem"
              class="shrink-0"
              placeholder="文件名"
              data-testid="md-file-name"
            />
            <NButton
              size="tiny"
              type="primary"
              :loading="exporting"
              :disabled="mdHtml === ''"
              title="导出 HTML 到输出目录"
              data-testid="export-html"
              @click="exportFile('html', mdFileName, mdPreviewDoc)"
            >
              <Download class="mr-1 h-3 w-3" />导出 HTML
            </NButton>
          </div>

          <div class="grid min-h-0 flex-1 gap-3 md:grid-cols-2 md:grid-rows-[minmax(0,1fr)]">
            <div
              class="flex min-h-72 flex-col overflow-hidden rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] md:min-h-0"
            >
              <div
                class="flex flex-wrap items-center gap-1 border-b border-[var(--lumin-color-border, #e0e0e6)] bg-[var(--lumin-color-surface-muted)] px-1 py-0.5"
                data-testid="md-toolbar"
              >
                <template v-for="(group, index) in TOOLBAR_GROUPS" :key="index">
                  <span
                    v-if="index > 0"
                    class="mx-1 h-4 w-px bg-[var(--lumin-color-border, #e0e0e6)]"
                    aria-hidden="true"
                  ></span>
                  <NButton
                    v-for="item in group"
                    :key="item.command"
                    size="tiny"
                    quaternary
                    :disabled="!editorReady"
                    :title="item.title"
                    :aria-label="item.title"
                    :data-testid="`md-fmt-${item.command}`"
                    @click="runToolbar(item.command)"
                  >
                    <component :is="item.icon" class="h-3.5 w-3.5" />
                  </NButton>
                </template>
              </div>
              <div
                ref="editorHost"
                class="min-h-0 flex-1 overflow-hidden"
                data-testid="md-input"
              ></div>
              <div
                class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-xs text-[var(--lumin-color-text-secondary)]"
                data-testid="md-statusbar"
              >
                <span class="flex min-w-0 items-center gap-1">
                  <span class="max-w-40 truncate" :title="mdFilePath" data-testid="md-file">
                    {{ mdFileNameLabel }}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span data-testid="md-save-state">{{ mdDirty ? '未保存' : '已保存' }}</span>
                  <span
                    v-if="mdDirty"
                    class="text-[var(--lumin-color-warning)]"
                    data-testid="md-dirty"
                    aria-label="有未保存的更改"
                  >
                    ●
                  </span>
                </span>
                <span class="flex items-center gap-2 whitespace-nowrap">
                  <span data-testid="md-stats">字符 {{ mdChars }} · 行 {{ mdLines }}</span>
                  <span aria-hidden="true">|</span>
                  <span data-testid="md-cursor"
                    >行 {{ mdCursor.line }}, 列 {{ mdCursor.column }}</span
                  >
                </span>
              </div>
            </div>

            <div class="flex min-h-72 flex-col md:min-h-0">
              <iframe
                v-if="mdHtml !== ''"
                data-testid="md-preview"
                class="h-full w-full flex-1 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] bg-white"
                title="Markdown 预览"
                sandbox=""
                :srcdoc="mdPreviewDoc"
              ></iframe>
              <div
                v-else
                class="flex flex-1 items-center justify-center rounded-[var(--lumin-radius-md)] border border-dashed border-[var(--lumin-color-border, #e0e0e6)] text-sm text-[var(--lumin-color-text-secondary)]"
              >
                在左侧输入 Markdown，或点击「载入示例」
              </div>
            </div>
          </div>

          <div
            v-if="mdFailure !== null"
            role="alert"
            class="text-sm text-[var(--lumin-color-error)]"
            data-testid="md-error"
          >
            {{ mdFailure.code }} · {{ failureText(mdFailure) }}
          </div>
        </div>
      </NTabPane>

      <!-- JSON → TypeScript -->
      <NTabPane name="json" tab="JSON→TS">
        <div class="flex flex-col gap-3 pt-2">
          <div class="grid gap-3 md:grid-cols-2">
            <div class="flex flex-col gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <NText depth="2" class="text-sm">
                  {{ tsStyle === 'json-schema' ? '根标题' : '根类型名' }}
                </NText>
                <NInput
                  v-model:value="rootName"
                  size="small"
                  class="w-32"
                  data-testid="ts-root-name"
                />
                <NRadioGroup v-model:value="tsStyle" size="small" data-testid="ts-style">
                  <NRadioButton value="interface">interface</NRadioButton>
                  <NRadioButton value="type">type</NRadioButton>
                  <NRadioButton value="json-schema">json-schema</NRadioButton>
                </NRadioGroup>
              </div>
              <div data-testid="ts-input">
                <NInput
                  v-model:value="jsonInput"
                  type="textarea"
                  placeholder='粘贴 JSON，例如：{"id":1,"name":"lumin"}'
                  :autosize="{ minRows: 16, maxRows: 40 }"
                  :input-props="{ class: 'font-mono text-xs', spellcheck: false }"
                />
              </div>
              <div
                v-if="tsFailure !== null"
                role="alert"
                class="text-sm text-[var(--lumin-color-error)]"
                data-testid="ts-error"
              >
                {{ tsFailure.code }} · {{ failureText(tsFailure) }}
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <NText depth="2" class="text-sm">生成结果</NText>
              <div data-testid="ts-output">
                <NInput
                  :value="tsCode"
                  type="textarea"
                  readonly
                  placeholder="生成结果将显示在这里"
                  :autosize="{ minRows: 16, maxRows: 40 }"
                  :input-props="{ class: 'font-mono text-xs', spellcheck: false }"
                />
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <NButton
              size="small"
              secondary
              :disabled="tsCode === ''"
              @click="copyText('ts', tsCode)"
            >
              <Copy class="mr-1 h-3 w-3" />{{ copiedKey === 'ts' ? '已复制' : '复制代码' }}
            </NButton>
            <NInput
              v-model:value="tsFileName"
              size="small"
              class="w-48"
              placeholder="文件名"
              data-testid="ts-file-name"
            />
            <NButton
              size="small"
              type="primary"
              :loading="exporting"
              :disabled="tsCode === ''"
              data-testid="export-ts"
              @click="exportFile(tsExtension, tsFileName, tsCode)"
            >
              <Download class="mr-1 h-3 w-3" />导出 .{{ tsExtension }}
            </NButton>
          </div>
        </div>
      </NTabPane>

      <!-- YAML -->
      <NTabPane name="yaml" tab="YAML">
        <div class="flex flex-col gap-3 pt-2">
          <div class="flex flex-wrap items-center gap-2">
            <NRadioGroup v-model:value="yamlMode" size="small" data-testid="yaml-mode">
              <NRadioButton value="yaml-to-json">YAML→JSON</NRadioButton>
              <NRadioButton value="json-to-yaml">JSON→YAML</NRadioButton>
              <NRadioButton value="format-yaml">格式化 YAML</NRadioButton>
            </NRadioGroup>
            <NText depth="3" class="text-xs">格式化会移除注释、展开锚点</NText>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <div class="flex flex-col gap-2">
              <NText depth="2" class="text-sm">输入</NText>
              <div data-testid="yaml-input">
                <NInput
                  v-model:value="yamlInput"
                  type="textarea"
                  :placeholder="YAML_PLACEHOLDERS[yamlMode]"
                  :autosize="{ minRows: 16, maxRows: 40 }"
                  :input-props="{ class: 'font-mono text-xs', spellcheck: false }"
                />
              </div>
              <div
                v-if="yamlFailure !== null"
                role="alert"
                class="text-sm text-[var(--lumin-color-error)]"
                data-testid="yaml-error"
              >
                {{ yamlFailure.code }} · {{ failureText(yamlFailure) }}
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <NText depth="2" class="text-sm">输出</NText>
              <div data-testid="yaml-output">
                <NInput
                  :value="yamlOutput"
                  type="textarea"
                  readonly
                  placeholder="转换结果将显示在这里"
                  :autosize="{ minRows: 16, maxRows: 40 }"
                  :input-props="{ class: 'font-mono text-xs', spellcheck: false }"
                />
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <NButton
              size="small"
              secondary
              :disabled="yamlOutput === ''"
              @click="copyText('yaml', yamlOutput)"
            >
              <Copy class="mr-1 h-3 w-3" />{{ copiedKey === 'yaml' ? '已复制' : '复制结果' }}
            </NButton>
            <NInput
              v-model:value="yamlFileName"
              size="small"
              class="w-48"
              placeholder="文件名"
              data-testid="yaml-file-name"
            />
            <NButton
              size="small"
              type="primary"
              :loading="exporting"
              :disabled="yamlOutput === ''"
              data-testid="export-yaml"
              @click="exportFile(yamlExtension, yamlFileName, yamlOutput)"
            >
              <Download class="mr-1 h-3 w-3" />导出 .{{ yamlExtension }}
            </NButton>
          </div>
        </div>
      </NTabPane>
    </NTabs>

    <NModal
      v-model:show="confirmOpenVisible"
      preset="dialog"
      type="warning"
      title="放弃未保存的更改？"
      positive-text="放弃并打开"
      negative-text="取消"
      @positive-click="confirmOpen"
    >
      当前 Markdown 有未保存的修改，继续打开将丢失这些修改。
    </NModal>

    <NModal
      v-model:show="overwriteVisible"
      preset="dialog"
      type="warning"
      title="文件已被其他程序修改"
      positive-text="覆盖保存"
      negative-text="取消"
      @positive-click="confirmOverwrite"
    >
      磁盘上的文件在打开后被修改，覆盖将丢失对方的更改。
    </NModal>
  </div>
</template>
