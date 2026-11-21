<!-- 页签四：临时文件清理（D6） -->
<script setup lang="ts">
// 作者：cuilanchao · 修改时间：2026-11-21
import { computed, ref } from 'vue'
import { NButton, NCheckbox, NInput, NPopconfirm, NText } from 'naive-ui'
import { FolderOpen, RotateCw, Search, Trash2 } from '@lucide/vue'
import { fileNameOf, formatBytes, formatTime } from '@lumin/shared'
import type { TempCleanResult, TempFile } from '../schema'
import { TRASH_BATCH } from '../schema'
import { chunkPaths, parseExtensions } from '../tree'
import { tempClean } from './client'
import { useTask } from './use-task'
import TaskFeedback from './TaskFeedback.vue'

const props = defineProps<{ root: string; extensionsText: string }>()
const emit = defineEmits<{ 'update:root': [string]; 'update:extensionsText': [string] }>()

const recursive = ref(true)
const files = ref<TempFile[]>([])
const selected = ref<Set<string>>(new Set())
const stats = ref<Pick<TempCleanResult, 'matchedBytes' | 'scannedFiles' | 'skipped'> | null>(null)
const trashNotice = ref('')
const trashing = ref(false)

const { running, progress, error, errorDetail, notice, submit, cancel, fail } =
  useTask<TempCleanResult>((result) => {
    files.value = result.files
    selected.value = new Set()
    stats.value = {
      matchedBytes: result.matchedBytes,
      scannedFiles: result.scannedFiles,
      skipped: result.skipped
    }
    trashNotice.value =
      result.files.length === 0
        ? '未发现匹配的临时文件'
        : `找到 ${result.files.length} 个文件 · 合计 ${formatBytes(result.matchedBytes)}`
  })

const busy = computed(() => running.value || trashing.value)
const allSelected = computed(() => files.value.length > 0 && selected.value.size === files.value.length)

const summary = computed(() => {
  const current = stats.value
  if (current === null) return ''
  const skipped = current.skipped > 0 ? ` · 跳过 ${current.skipped}` : ''
  return `共检查 ${current.scannedFiles} 个文件${skipped}`
})

async function chooseDir(): Promise<void> {
  try {
    const picked = await window.lumin.pickDirectory('选择要清理的目录')
    if (picked === null) return
    emit('update:root', picked)
    files.value = []
    selected.value = new Set()
    stats.value = null
    trashNotice.value = ''
  } catch (err) {
    fail(err)
  }
}

function start(): void {
  if (props.root === '' || busy.value) return
  const extensions = parseExtensions(props.extensionsText)
  if (extensions.length === 0) {
    error.value = { code: 'FC_INVALID_PAYLOAD', message: '请至少填写一个扩展名规则' }
    return
  }
  files.value = []
  selected.value = new Set()
  stats.value = null
  trashNotice.value = ''
  void submit(() => tempClean({ root: props.root, recursive: recursive.value, extensions }))
}

function toggle(path: string, checked: boolean): void {
  const next = new Set(selected.value)
  if (checked) next.add(path)
  else next.delete(path)
  selected.value = next
}

function toggleAll(checked: boolean): void {
  selected.value = checked ? new Set(files.value.map((file) => file.path)) : new Set()
}

/** 仅勾选 7 天前修改的文件 */
function selectOlderThanWeek(): void {
  const threshold = Date.now() - 7 * 24 * 60 * 60 * 1000
  selected.value = new Set(
    files.value.filter((file) => file.mtimeMs < threshold).map((file) => file.path)
  )
}

/** 回收站分批调用（单批 ≤200，失败项不中断） */
async function trashSelected(): Promise<void> {
  if (selected.value.size === 0 || trashing.value) return
  error.value = null
  trashing.value = true
  try {
    const trashed: string[] = []
    const failed: { path: string; message: string }[] = []
    for (const batch of chunkPaths([...selected.value], TRASH_BATCH)) {
      const outcome = await window.lumin.trashPaths(batch)
      trashed.push(...outcome.trashed)
      failed.push(...outcome.failed)
    }
    if (trashed.length > 0) {
      const removed = new Set(trashed)
      files.value = files.value.filter((file) => !removed.has(file.path))
      selected.value = new Set([...selected.value].filter((path) => !removed.has(path)))
    }
    const suffix =
      failed.length === 0
        ? ''
        : `；${failed.length} 个失败（${failed[0]?.message ?? '原因未知'}）`
    trashNotice.value = `已移入回收站 ${trashed.length} 个文件${suffix}`
  } catch (err) {
    fail(err)
  } finally {
    trashing.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="text-sm text-[var(--lumin-color-text-secondary)]">
      按扩展名规则扫描临时/备份类文件，勾选后移入回收站；只扫描不删除，需确认后才回收。
    </p>

    <div class="flex items-center gap-2">
      <NInput :value="root" placeholder="选择要清理的目录" readonly />
      <NButton :disabled="busy" @click="chooseDir">
        <FolderOpen class="mr-1 h-3.5 w-3.5" />选择目录
      </NButton>
    </div>

    <div class="flex flex-wrap items-center gap-4">
      <NCheckbox
        :checked="recursive"
        :disabled="busy"
        @update:checked="recursive = $event"
      >
        包含子目录
      </NCheckbox>
      <div class="flex items-center gap-2">
        <NText depth="2" class="text-sm">扩展名规则</NText>
        <NInput
          :value="extensionsText"
          placeholder="tmp,temp,log,bak"
          :disabled="busy"
          class="w-64"
          @update:value="(value) => emit('update:extensionsText', value)"
        />
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <NButton type="primary" :disabled="busy || root === ''" @click="start">
        <Search class="mr-1 h-3.5 w-3.5" />扫描匹配文件
      </NButton>
      <NButton v-if="files.length > 0" size="small" quaternary :disabled="busy" @click="toggleAll(!allSelected)">
        {{ allSelected ? '全不选' : '全选' }}
      </NButton>
      <NButton v-if="files.length > 0" size="small" quaternary :disabled="busy" @click="selectOlderThanWeek">
        仅选 7 天前
      </NButton>
      <NButton size="small" :disabled="busy" @click="start">
        <RotateCw class="mr-1 h-3.5 w-3.5" />重新扫描
      </NButton>
      <NPopconfirm v-if="selected.size > 0" @positive-click="trashSelected">
        <template #trigger>
          <NButton size="small" type="error" :disabled="busy || selected.size === 0">
            <Trash2 class="mr-1 h-3.5 w-3.5" />移入回收站（{{ selected.size }}）
          </NButton>
        </template>
        确认把选中的 {{ selected.size }} 个文件移入回收站？
      </NPopconfirm>
    </div>

    <TaskFeedback
      :running="running"
      :progress="progress"
      :error="error"
      :error-detail="errorDetail"
      :notice="notice"
      @cancel="cancel"
      @retry="start"
    />

    <NText v-if="trashNotice && !running" depth="3" class="text-xs">{{ trashNotice }}</NText>
    <NText v-if="summary" depth="3" class="text-xs">{{ summary }}</NText>

    <div v-if="files.length > 0" class="flex max-h-96 flex-col gap-1 overflow-auto">
      <div
        v-for="file in files"
        :key="file.path"
        class="flex items-start gap-2 rounded-[var(--lumin-radius-md)] px-2 py-1 hover:bg-[var(--lumin-color-surface)]"
      >
        <NCheckbox
          :checked="selected.has(file.path)"
          :disabled="busy"
          @update:checked="(checked) => toggle(file.path, checked)"
        />
        <div class="flex min-w-0 flex-col">
          <span class="text-sm">{{ fileNameOf(file.path) }}</span>
          <span class="text-xs break-all text-[var(--lumin-color-text-secondary)]">
            {{ file.path }} · {{ formatBytes(file.size) }} · {{ formatTime(file.mtimeMs) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
