<script setup lang="ts">
/**
 * @file 文本编辑器页面（空/加载/错误三态 + CodeMirror 编辑区）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 打开/编辑/保存文本文件；编码与 EOL 仅作为保存参数，切换不清空内容；
 *              离开页面前拦截未保存更改（路由守卫 + beforeunload + NModal 确认）。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { NButton, NInput, NModal, NSelect, NSwitch } from 'naive-ui'
import { AlertTriangle, FileOutput, PencilLine, RotateCcw, Save, Search } from '@lucide/vue'
import { toStructuredError, type StructuredError, type TextEncoding } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import { splitPath, type EolKind } from '../formats'
import type { OpenResult } from '../schema'
import { open as openDocument, save as saveDocument, saveAs as saveAsDocument } from './client'
import { createEditor, type EditorHandle } from './createEditor'

type Phase = 'empty' | 'loading' | 'ready' | 'error'

/** 编码下拉项 */
const ENCODING_OPTIONS: { label: string; value: TextEncoding }[] = [
  { label: 'UTF-8', value: 'utf8' },
  { label: 'UTF-8 BOM', value: 'utf8-bom' },
  { label: 'UTF-16 LE', value: 'utf16le' },
  { label: 'GBK', value: 'gbk' }
]

/** EOL 下拉项（保存仅支持 LF / CRLF） */
const EOL_OPTIONS: { label: string; value: EolKind }[] = [
  { label: 'LF', value: 'lf' },
  { label: 'CRLF', value: 'crlf' }
]

const phase = ref<Phase>('empty')
const hasSession = ref(false)
const errInfo = ref<StructuredError | null>(null)
const errorAction = ref<'open' | 'save' | null>(null)

const filePath = ref('')
const fileName = ref('')
const mtimeMs = ref<number | null>(null)
const encoding = ref<TextEncoding>('utf8')
const eol = ref<EolKind>('lf')
const readOnly = ref(false)
const dirty = ref(false)
const saving = ref(false)
const charCount = ref(0)
const cursor = ref({ line: 1, column: 1 })
const invalidHint = ref('')

const saveAsVisible = ref(false)
const saveAsDir = ref('')
const saveAsName = ref('')
const saveAsError = ref('')
const saveAsSaving = ref(false)
const pickingDir = ref(false)

const leaveModal = ref(false)

const editorHost = ref<HTMLDivElement | null>(null)
let editor: EditorHandle | null = null
/** 未保存正文快照（保存失败/另存为时取用；编辑器可能处于错误态） */
let bufferText = ''

/** 允许本次路由离开的 resolver（由守卫注入） */
let allowLeave: (() => void) | null = null
/** 阻止本次路由离开的 resolver（由守卫注入） */
let blockLeave: (() => void) | null = null

const displayName = computed(() => (fileName.value === '' ? '未命名' : fileName.value))
const encodingLabel = computed(
  () => ENCODING_OPTIONS.find((item) => item.value === encoding.value)?.label ?? encoding.value
)
const eolLabel = computed(
  () => EOL_OPTIONS.find((item) => item.value === eol.value)?.label ?? eol.value.toUpperCase()
)
const errorDetail = computed(() => errInfo.value?.detail ?? '')

/** 记录光标/字数（CodeMirror update 回调） */
function onEditorChange(length: number): void {
  dirty.value = true
  charCount.value = length
}

/** 销毁编辑器实例（切换文件/卸载页面） */
function destroyEditor(): void {
  editor?.destroy()
  editor = null
}

/**
 * 挂载 CodeMirror（动态 import；R5 取舍见 createEditor 注释）
 * @param content 初始正文
 */
async function mountEditor(content: string): Promise<void> {
  destroyEditor()
  await nextTick()
  const host = editorHost.value
  if (host === null) throw new Error('编辑器容器未就绪')
  host.innerHTML = ''
  editor = await createEditor({
    container: host,
    content,
    onChange: onEditorChange,
    onCursor: (position) => {
      cursor.value = position
    }
  })
  bufferText = content
  charCount.value = content.length
  cursor.value = { line: 1, column: 1 }
  editor.focus()
}

/** 打开结果 → 页面状态 */
function applyOpen(result: OpenResult): void {
  filePath.value = result.path
  fileName.value = result.name
  mtimeMs.value = result.mtimeMs
  encoding.value = result.encoding
  eol.value = result.eol === 'cr' ? 'lf' : result.eol
  readOnly.value = result.readOnly
  dirty.value = false
  errInfo.value = null
  errorAction.value = null
}

/**
 * 打开文件（空态拖拽/选择触发）
 * @param path 磁盘绝对路径
 */
async function openFile(path: string): Promise<void> {
  destroyEditor()
  hasSession.value = false
  phase.value = 'loading'
  errInfo.value = null
  errorAction.value = null
  dirty.value = false
  try {
    const result = await openDocument({ path })
    applyOpen(result)
    phase.value = 'ready'
    hasSession.value = true
    await mountEditor(result.content)
  } catch (err) {
    destroyEditor()
    hasSession.value = false
    errInfo.value = toStructuredError(err)
    errorAction.value = 'open'
    phase.value = 'error'
  }
}

/** 拖拽/选择回调 */
function onSelect(payload: { file: File; path: string }): void {
  invalidHint.value = ''
  void openFile(payload.path)
}

/** DropZone 校验失败 */
function onInvalid(reason: string): void {
  invalidHint.value = reason
}

/** 新建空白（未命名，保存时走 save-as） */
async function newBlank(): Promise<void> {
  destroyEditor()
  filePath.value = ''
  fileName.value = ''
  mtimeMs.value = null
  encoding.value = 'utf8'
  eol.value = 'lf'
  readOnly.value = false
  dirty.value = false
  errInfo.value = null
  errorAction.value = null
  invalidHint.value = ''
  hasSession.value = true
  phase.value = 'ready'
  try {
    await mountEditor('')
  } catch (err) {
    hasSession.value = false
    errInfo.value = toStructuredError(err)
    phase.value = 'error'
  }
}

/** 回到空态（错误页「重新选择」） */
function resetToEmpty(): void {
  destroyEditor()
  hasSession.value = false
  phase.value = 'empty'
  errInfo.value = null
  errorAction.value = null
  dirty.value = false
  filePath.value = ''
  fileName.value = ''
  mtimeMs.value = null
  bufferText = ''
}

/** 保存失败 → 错误态（保留编辑器实例与正文，便于强制重试） */
function showSaveError(err: unknown): void {
  bufferText = editor?.getContent() ?? bufferText
  errInfo.value = toStructuredError(err)
  errorAction.value = 'save'
  phase.value = 'error'
}

/**
 * 保存到现有路径（未命名则弹另存为）
 * @param force 忽略 mtime 冲突（TE_FILE_CHANGED 后强制覆盖）
 * @returns 是否保存成功
 */
async function persist(force: boolean): Promise<boolean> {
  if (readOnly.value) return false
  if (filePath.value === '') {
    openSaveAsDialog()
    return false
  }
  const handle = editor
  if (handle === null) return false
  saving.value = true
  try {
    const content = handle.getContent()
    bufferText = content
    const result = await saveDocument({
      path: filePath.value,
      content,
      encoding: encoding.value,
      eol: eol.value,
      ...(mtimeMs.value === null ? {} : { expectedMtimeMs: mtimeMs.value }),
      ...(force ? { force: true } : {})
    })
    mtimeMs.value = result.mtimeMs
    dirty.value = false
    errInfo.value = null
    errorAction.value = null
    if (phase.value === 'error') phase.value = 'ready'
    return true
  } catch (err) {
    showSaveError(err)
    return false
  } finally {
    saving.value = false
  }
}

/** 工具栏保存 / Ctrl+S */
async function onSave(): Promise<void> {
  if (phase.value === 'loading' || saving.value) return
  await persist(false)
}

/** 错误页「重试」：保存错误强制覆盖，打开错误重新读取 */
async function retry(): Promise<void> {
  if (errorAction.value === 'save') {
    await persist(true)
    return
  }
  if (filePath.value !== '') {
    await openFile(filePath.value)
    return
  }
  openSaveAsDialog()
}

/** 打开另存为弹窗 */
function openSaveAsDialog(): void {
  if (filePath.value !== '') {
    const parts = splitPath(filePath.value)
    saveAsDir.value = parts.dir
    saveAsName.value = parts.name
  } else if (saveAsName.value === '') {
    saveAsName.value = '未命名.txt'
  }
  saveAsError.value = ''
  saveAsVisible.value = true
}

/** 系统目录选择对话框 */
async function pickDirectory(): Promise<void> {
  pickingDir.value = true
  saveAsError.value = ''
  try {
    const dir = await window.lumin.pickDirectory('选择保存目录')
    if (dir !== null && dir !== '') saveAsDir.value = dir
  } catch (err) {
    saveAsError.value = toStructuredError(err).message
  } finally {
    pickingDir.value = false
  }
}

/** 确认另存为（目标已存在时展示 TE_FILE_EXISTS 文案） */
async function confirmSaveAs(): Promise<void> {
  const handle = editor
  if (handle === null) return
  const dir = saveAsDir.value.trim()
  const name = saveAsName.value.trim()
  if (dir === '') {
    saveAsError.value = '请填写保存目录'
    return
  }
  if (name === '') {
    saveAsError.value = '请填写文件名'
    return
  }
  saveAsSaving.value = true
  try {
    const content = handle.getContent()
    const result = await saveAsDocument({
      dir,
      name,
      content,
      encoding: encoding.value,
      eol: eol.value
    })
    saveAsVisible.value = false
    filePath.value = result.path
    fileName.value = name
    mtimeMs.value = result.mtimeMs
    dirty.value = false
    errInfo.value = null
    errorAction.value = null
    phase.value = 'ready'
    hasSession.value = true
    await mountEditor(content)
  } catch (err) {
    const structured = toStructuredError(err)
    saveAsError.value =
      structured.detail === undefined
        ? structured.message
        : `${structured.message}（${structured.detail}）`
  } finally {
    saveAsSaving.value = false
  }
}

/** 工具栏「查找」→ CM 查找面板 */
function openSearch(): void {
  editor?.openSearch()
}

/** Ctrl+S / Ctrl+F（Ctrl+F 由 CM searchKeymap 处理） */
function onWindowKeydown(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey)) return
  if (event.key.toLowerCase() !== 's') return
  event.preventDefault()
  void onSave()
}

/** 未保存离开确认：保存并离开 */
async function saveAndLeave(): Promise<void> {
  const ok = await persist(false)
  if (ok) {
    dirty.value = false
    allowLeave?.()
  } else {
    blockLeave?.()
  }
}

/** 未保存离开确认：放弃更改 */
function discardAndLeave(): void {
  dirty.value = false
  allowLeave?.()
}

/** 未保存离开确认：取消 */
function cancelLeave(): void {
  blockLeave?.()
}

/** 关闭窗口前拦截（Electron 下触发浏览器原生确认） */
function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

/** 仅在存在未保存更改时挂载 beforeunload，避免无谓拦截关闭 */
function syncBeforeUnload(value: boolean): void {
  if (value) {
    window.addEventListener('beforeunload', onBeforeUnload)
  } else {
    window.removeEventListener('beforeunload', onBeforeUnload)
  }
}

watch(dirty, syncBeforeUnload)

onBeforeRouteLeave((_to, _from, next) => {
  if (!dirty.value) {
    next()
    return
  }
  leaveModal.value = true
  allowLeave = () => {
    leaveModal.value = false
    allowLeave = null
    blockLeave = null
    next()
  }
  blockLeave = () => {
    leaveModal.value = false
    allowLeave = null
    blockLeave = null
    next(false)
  }
})

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  destroyEditor()
})
</script>

<template>
  <section class="flex h-full flex-col gap-4 p-4">
    <!-- 空态 -->
    <div
      v-if="phase === 'empty'"
      class="flex flex-1 flex-col items-center justify-center gap-3"
      data-testid="text-editor-empty"
    >
      <DropZone accept="" hint="拖拽文本文件到此处，或点击选择" @select="onSelect" @invalid="onInvalid" />
      <p v-if="invalidHint !== ''" class="text-xs text-[var(--lumin-color-danger)]">
        {{ invalidHint }}
      </p>
      <NButton size="small" @click="newBlank">
        <template #icon><PencilLine :size="16" /></template>
        新建空白
      </NButton>
    </div>

    <!-- 加载态 -->
    <div
      v-else-if="phase === 'loading'"
      class="flex flex-1 flex-col gap-3"
      aria-busy="true"
      data-testid="text-editor-loading"
    >
      <div class="h-8 w-1/3 animate-pulse rounded-[var(--lumin-radius-md)] bg-[var(--lumin-color-border)]" />
      <div class="flex-1 animate-pulse rounded-[var(--lumin-radius-lg)] bg-[var(--lumin-color-border)]" />
      <p class="text-sm text-[var(--lumin-color-text-secondary)]">正在打开…</p>
    </div>

    <!-- 编辑 / 错误态 -->
    <div v-else class="flex min-h-0 flex-1 flex-col gap-3">
      <header class="flex flex-wrap items-center gap-2 border-b border-[var(--lumin-color-border)] pb-3">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-medium text-[var(--lumin-color-text)]">
            {{ displayName }}
          </span>
          <span
            v-if="dirty"
            class="text-[var(--lumin-color-warning)]"
            aria-label="有未保存的更改"
          >
            ●
          </span>
        </div>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <NButton size="small" :disabled="readOnly || !hasSession || saving" @click="onSave">
            <template #icon><Save :size="16" /></template>
            保存
          </NButton>
          <NButton size="small" :disabled="!hasSession || saving" @click="openSaveAsDialog">
            <template #icon><FileOutput :size="16" /></template>
            另存为
          </NButton>
          <NButton size="small" :disabled="!hasSession" @click="openSearch">
            <template #icon><Search :size="16" /></template>
            查找
          </NButton>
          <label class="flex items-center gap-1 text-xs text-[var(--lumin-color-text-secondary)]">
            只读
            <NSwitch v-model:value="readOnly" size="small" aria-label="只读" />
          </label>
          <NSelect
            v-model:value="encoding"
            :options="ENCODING_OPTIONS"
            size="small"
            class="w-32"
            aria-label="编码"
          />
          <NSelect
            v-model:value="eol"
            :options="EOL_OPTIONS"
            size="small"
            class="w-24"
            aria-label="换行符"
          />
        </div>
      </header>

      <div
        class="relative min-h-0 flex-1 overflow-hidden rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)]"
      >
        <div
          ref="editorHost"
          class="h-full w-full"
          :class="hasSession ? '' : 'invisible'"
          data-testid="text-editor-host"
        />
        <!-- 错误态覆盖层（保留已加载正文，便于重试） -->
        <div
          v-if="phase === 'error' && errInfo !== null"
          class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--lumin-color-bg)] p-6 text-center"
          data-testid="text-editor-error"
        >
          <AlertTriangle :size="28" class="text-[var(--lumin-color-danger)]" aria-hidden="true" />
          <p class="text-sm text-[var(--lumin-color-text)]">{{ errInfo.message }}</p>
          <p class="text-xs text-[var(--lumin-color-text-secondary)]">错误码：{{ errInfo.code }}</p>
          <p v-if="errorDetail !== ''" class="max-w-full break-all text-xs text-[var(--lumin-color-text-secondary)]">
            详情：{{ errorDetail }}
          </p>
          <div class="mt-1 flex flex-wrap items-center justify-center gap-2">
            <NButton size="small" @click="retry">
              <template #icon><RotateCcw :size="16" /></template>
              重试
            </NButton>
            <NButton size="small" :disabled="!hasSession" @click="openSaveAsDialog">
              <template #icon><FileOutput :size="16" /></template>
              另存为
            </NButton>
            <NButton v-if="!hasSession" size="small" quaternary @click="resetToEmpty">
              重新选择
            </NButton>
          </div>
        </div>
      </div>

      <footer class="flex flex-wrap items-center gap-4 text-xs text-[var(--lumin-color-text-secondary)]">
        <span>行 {{ cursor.line }}，列 {{ cursor.column }}</span>
        <span>{{ charCount }} 字符</span>
        <span>{{ encodingLabel }}</span>
        <span>{{ eolLabel }}</span>
      </footer>
    </div>

    <!-- 未保存离开确认 -->
    <NModal
      v-model:show="leaveModal"
      preset="card"
      title="有未保存的更改"
      class="w-[460px]"
      :closable="false"
      :mask-closable="false"
    >
      <p class="text-sm text-[var(--lumin-color-text-secondary)]">
        当前文件有未保存的更改，离开将丢失这些修改。
      </p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="cancelLeave">取消</NButton>
          <NButton size="small" secondary @click="discardAndLeave">放弃更改</NButton>
          <NButton size="small" type="primary" :loading="saving" @click="saveAndLeave">
            保存并离开
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- 另存为 -->
    <NModal
      v-model:show="saveAsVisible"
      preset="card"
      title="另存为"
      class="w-[520px]"
      :closable="false"
      :mask-closable="false"
    >
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">保存目录</span>
          <div class="flex gap-2">
            <NInput v-model:value="saveAsDir" placeholder="例如 D:\文档" aria-label="保存目录" />
            <NButton :loading="pickingDir" @click="pickDirectory">选择…</NButton>
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">文件名</span>
          <NInput v-model:value="saveAsName" placeholder="例如 说明.txt" aria-label="文件名" />
        </div>
        <p v-if="saveAsError !== ''" class="text-xs text-[var(--lumin-color-danger)]">
          {{ saveAsError }}
        </p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="saveAsVisible = false">取消</NButton>
          <NButton size="small" type="primary" :loading="saveAsSaving" @click="confirmSaveAs">
            保存
          </NButton>
        </div>
      </template>
    </NModal>
  </section>
</template>
