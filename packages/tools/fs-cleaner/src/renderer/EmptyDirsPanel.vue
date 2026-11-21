<!-- 页签二：空文件夹清理（D4） -->
<script setup lang="ts">
// 作者：cuilanchao · 修改时间：2026-11-21
import { computed, ref } from 'vue'
import { NButton, NCheckbox, NInput, NPopconfirm, NText } from 'naive-ui'
import { FolderOpen, RotateCw, Search, Trash2 } from '@lucide/vue'
import { TRASH_BATCH, type EmptyDirsResult } from '../schema'
import { chunkPaths } from '../tree'
import { emptyDirs } from './client'
import { useTask } from './use-task'
import TaskFeedback from './TaskFeedback.vue'

const props = defineProps<{ root: string }>()
const emit = defineEmits<{ 'update:root': [string] }>()

const dirs = ref<string[]>([])
const selected = ref<Set<string>>(new Set())
const scannedDirs = ref(0)
const trashNotice = ref('')
const trashing = ref(false)

const { running, progress, error, errorDetail, notice, submit, cancel, fail } =
  useTask<EmptyDirsResult>((result) => {
    dirs.value = result.dirs
    selected.value = new Set()
    scannedDirs.value = result.scannedDirs
    trashNotice.value =
      result.dirs.length === 0 ? '未发现空文件夹' : `发现 ${result.dirs.length} 个空文件夹`
  })

const busy = computed(() => running.value || trashing.value)
const allSelected = computed(() => dirs.value.length > 0 && selected.value.size === dirs.value.length)

async function chooseDir(): Promise<void> {
  try {
    const picked = await window.lumin.pickDirectory('选择要清理的目录')
    if (picked === null) return
    emit('update:root', picked)
    dirs.value = []
    selected.value = new Set()
    trashNotice.value = ''
  } catch (err) {
    fail(err)
  }
}

function start(): void {
  if (props.root === '' || busy.value) return
  dirs.value = []
  selected.value = new Set()
  trashNotice.value = ''
  void submit(() => emptyDirs({ root: props.root }))
}

function toggle(path: string, checked: boolean): void {
  const next = new Set(selected.value)
  if (checked) next.add(path)
  else next.delete(path)
  selected.value = next
}

function toggleAll(checked: boolean): void {
  selected.value = checked ? new Set(dirs.value) : new Set()
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
      dirs.value = dirs.value.filter(
        (dir) => !trashed.some((parent) => dir === parent || dir.startsWith(`${parent}\\`))
      )
      selected.value = new Set([...selected.value].filter((path) => !removed.has(path)))
    }
    const suffix =
      failed.length === 0
        ? ''
        : `；${failed.length} 个失败（${failed[0]?.message ?? '原因未知'}）`
    trashNotice.value = `已移入回收站 ${trashed.length} 个文件夹${suffix}`
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
      递归检测不含任何内容的文件夹（子文件夹全空时父文件夹也算空），勾选后移入回收站，不做永久删除。
    </p>

    <div class="flex items-center gap-2">
      <NInput :value="root" placeholder="选择要清理的目录" readonly />
      <NButton :disabled="busy" @click="chooseDir">
        <FolderOpen class="mr-1 h-3.5 w-3.5" />选择目录
      </NButton>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <NButton type="primary" :disabled="busy || root === ''" @click="start">
        <Search class="mr-1 h-3.5 w-3.5" />扫描空文件夹
      </NButton>
      <NButton v-if="dirs.length > 0" size="small" quaternary :disabled="busy" @click="toggleAll(!allSelected)">
        {{ allSelected ? '全不选' : '全选' }}
      </NButton>
      <NButton size="small" :disabled="busy" @click="start">
        <RotateCw class="mr-1 h-3.5 w-3.5" />重新扫描
      </NButton>
      <NPopconfirm
        v-if="selected.size > 0"
        @positive-click="trashSelected"
      >
        <template #trigger>
          <NButton size="small" type="error" :disabled="busy || selected.size === 0">
            <Trash2 class="mr-1 h-3.5 w-3.5" />移入回收站（{{ selected.size }}）
          </NButton>
        </template>
        确认把选中的 {{ selected.size }} 个空文件夹移入回收站？
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
    <NText v-if="scannedDirs > 0" depth="3" class="text-xs">共检查 {{ scannedDirs }} 个目录</NText>

    <div v-if="dirs.length > 0" class="flex max-h-96 flex-col gap-1 overflow-auto">
      <div
        v-for="dir in dirs"
        :key="dir"
        class="flex items-start gap-2 rounded-[var(--lumin-radius-md)] px-2 py-1 hover:bg-[var(--lumin-color-surface)]"
      >
        <NCheckbox
          :checked="selected.has(dir)"
          :disabled="busy"
          @update:checked="(checked) => toggle(dir, checked)"
        />
        <span class="text-sm break-all">{{ dir }}</span>
      </div>
    </div>
  </div>
</template>
